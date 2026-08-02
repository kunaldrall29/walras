import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import {
  Address,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
  hash,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-sdk";

/**
 * An in-process stand-in for Soroban RPC.
 *
 * Why this exists: `ExactStellarScheme` reaches the interesting half of its verification —
 * auth-entry expiry, signature status, sub-invocations, transfer-event checks — only
 * *after* `simulateTransaction` succeeds (see the step ordering in the package's
 * `_verify`). Simulation cannot succeed against live testnet until a buyer holds testnet
 * USDC, which is exactly what FACTS Q-011 is blocked on. Without a double, every fixture
 * would collapse into the same `invalid_exact_stellar_payload_simulation_failed` and the
 * tests would prove nothing about the codes past that point.
 *
 * ## What it models
 *
 * - **Auth-entry signatures.** Every address-credential entry carrying a signature is
 *   verified for real: Ed25519 over `hash(HashIdPreimage.envelopeTypeSorobanAuthorization)`,
 *   the same CAP-46 preimage `authorizeEntry` signs. A tampered signature fails here, as
 *   it would in the Soroban host, and simulation returns an error.
 * - **Transfer events.** A successful simulation emits one SEP-41 `transfer` contract
 *   event — topics `["transfer", from, to]`, data the i128 amount — synthesized from the
 *   invocation actually present in the transaction. Rewrite the amount in the transaction
 *   and the event follows it, so the package's event checks are exercised honestly rather
 *   than fed a hard-coded answer.
 * - **Wire shapes.** `getLatestLedger` and the submitter's account entry replay responses
 *   captured verbatim from live testnet (see `scripts/build-fixtures.mjs`).
 *
 * ## What it does not model
 *
 * It is not a Soroban VM. It does not track balances, footprints, or nonce consumption,
 * and it does not reject an entry whose signature field is still `scvVoid` — it treats
 * that as the recording-mode case, the same reading the SDK's own
 * `gatherAuthEntrySignatureStatus` takes when it reports an address as pending signature.
 * On live RPC an unsigned entry would additionally fail simulation in enforcing mode.
 *
 * Results obtained through this double are therefore *modelled*, not observed on-chain,
 * and are labelled as such wherever they are reported.
 */

/** A captured `getLatestLedger` response, minus the ledger close meta. */
export interface CapturedLatestLedger {
  id: string;
  protocolVersion: number;
  sequence: number;
  closeTime: string;
  headerXdr: string;
}

export interface SorobanRpcDoubleOptions {
  /** Network passphrase used to derive the auth-entry signature preimage. */
  networkPassphrase: string;
  /** Captured `getLatestLedger` response; its `sequence` is the ledger height reported. */
  latestLedger: CapturedLatestLedger;
  /** Resource fee in stroops reported by simulation. Defaults to a realistic testnet value. */
  minResourceFee?: string;
  /** Status returned by `getTransaction` while polling a submitted settlement. */
  transactionStatus?: "SUCCESS" | "FAILED";
  /** Status returned by `sendTransaction`. Anything but PENDING makes settlement fail. */
  sendStatus?: "PENDING" | "ERROR";
}

export interface SorobanRpcDouble {
  /** Base URL to hand to the facilitator as `RPC_URL`. */
  url: string;
  /** Every JSON-RPC method name received, in order. */
  calls: string[];
  /** Hash of the last transaction accepted by `sendTransaction`, if any. */
  lastSubmittedHash: string | null;
  /** Base64 envelope of the last transaction accepted by `sendTransaction`, if any. */
  lastSubmittedEnvelope: string | null;
  /** Shuts the listener down. */
  close: () => Promise<void>;
}

/**
 * Measured settlement fee on testnet is 23 073 stroops with a 100-stroop base fee on top
 * (FACTS F-054), so the resource-fee component is what is reported here. Staying close to
 * the observed value keeps the package's `maxTransactionFeeStroops` ceiling check
 * meaningful instead of trivially satisfied.
 */
const DEFAULT_MIN_RESOURCE_FEE = "22973";

/**
 * Recovers the `(publicKey, signature)` pairs from an auth entry's signature ScVal.
 *
 * `authorizeEntry` writes a vector of maps with `public_key` and `signature` keys for
 * Ed25519 accounts. A bare map is accepted too, since a single-signer entry may be
 * written either way.
 *
 * @param signature - The signature ScVal from address credentials.
 * @returns The signature pairs found, empty when the entry is unsigned.
 */
function extractSignaturePairs(signature: xdr.ScVal): Array<{ publicKey: Buffer; signature: Buffer }> {
  const maps: xdr.ScMapEntry[][] = [];

  if (signature.switch().name === "scvVec") {
    for (const element of signature.vec() ?? []) {
      if (element.switch().name === "scvMap") maps.push(element.map() ?? []);
    }
  } else if (signature.switch().name === "scvMap") {
    maps.push(signature.map() ?? []);
  }

  const pairs: Array<{ publicKey: Buffer; signature: Buffer }> = [];
  for (const entries of maps) {
    let publicKey: Buffer | undefined;
    let signatureBytes: Buffer | undefined;
    for (const entry of entries) {
      const key = entry.key().switch().name === "scvSymbol" ? entry.key().sym().toString() : "";
      if (key === "public_key") publicKey = Buffer.from(entry.val().bytes());
      if (key === "signature") signatureBytes = Buffer.from(entry.val().bytes());
    }
    if (publicKey && signatureBytes) pairs.push({ publicKey, signature: signatureBytes });
  }
  return pairs;
}

/**
 * Verifies every signed authorization entry on an operation.
 *
 * @param invokeOp - The invoke-host-function operation carrying the entries.
 * @param networkPassphrase - Passphrase whose hash forms the preimage's network id.
 * @returns An error string when a signature does not verify, otherwise null.
 */
function verifyAuthSignatures(
  invokeOp: Operation.InvokeHostFunction,
  networkPassphrase: string,
): string | null {
  const networkId = hash(Buffer.from(networkPassphrase));

  for (const entry of invokeOp.auth ?? []) {
    if (entry.credentials().switch() !== xdr.SorobanCredentialsType.sorobanCredentialsAddress()) {
      continue;
    }
    const credentials = entry.credentials().address();
    const pairs = extractSignaturePairs(credentials.signature());
    if (pairs.length === 0) {
      // Unsigned: recording mode. See the "what it does not model" note above.
      continue;
    }

    const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
      new xdr.HashIdPreimageSorobanAuthorization({
        networkId,
        nonce: credentials.nonce(),
        signatureExpirationLedger: credentials.signatureExpirationLedger(),
        invocation: entry.rootInvocation(),
      }),
    );
    const payload = hash(preimage.toXDR());
    const signerAddress = Address.fromScAddress(credentials.address()).toString();

    for (const pair of pairs) {
      let verified = false;
      try {
        verified = Keypair.fromPublicKey(signerAddress).verify(payload, pair.signature);
      } catch {
        verified = false;
      }
      if (!verified) {
        return `HostError: Error(Auth, InvalidAction): signature verification failed for ${signerAddress}`;
      }
    }
  }
  return null;
}

/**
 * Builds the SEP-41 transfer event a successful `transfer` invocation would emit.
 *
 * @param invokeArgs - The invoke-contract arguments taken from the transaction.
 * @returns A base64 `DiagnosticEvent`.
 */
function buildTransferEvent(invokeArgs: xdr.InvokeContractArgs): string {
  const args = invokeArgs.args();
  const event = new xdr.ContractEvent({
    ext: new xdr.ExtensionPoint(0),
    contractId: invokeArgs.contractAddress().contractId(),
    type: xdr.ContractEventType.contract(),
    body: new xdr.ContractEventBody(
      0,
      new xdr.ContractEventV0({
        topics: [nativeToScVal("transfer", { type: "symbol" }), args[0]!, args[1]!],
        data: args[2]!,
      }),
    ),
  });
  return new xdr.DiagnosticEvent({ inSuccessfulContractCall: true, event }).toXDR("base64");
}

/**
 * Synthesizes a minimal `LedgerCloseMeta` to accompany a captured ledger header.
 *
 * The SDK decodes this field on every `getLatestLedger` call, but nothing on the payment
 * path reads it — and the real one is ~124 KB, far too large to keep as a fixture.
 *
 * @param headerXdr - Base64 `LedgerHeader` captured from live RPC.
 * @returns Base64 `LedgerCloseMeta` wrapping that header with an empty transaction set.
 */
function synthesizeLedgerCloseMeta(headerXdr: string): string {
  const header = xdr.LedgerHeader.fromXDR(headerXdr, "base64");
  return new xdr.LedgerCloseMeta(
    0,
    new xdr.LedgerCloseMetaV0({
      ledgerHeader: new xdr.LedgerHeaderHistoryEntry({
        hash: Buffer.alloc(32),
        header,
        ext: new xdr.LedgerHeaderHistoryEntryExt(0),
      }),
      txSet: new xdr.TransactionSet({ previousLedgerHash: Buffer.alloc(32), txes: [] }),
      txProcessing: [],
      upgradesProcessing: [],
      scpInfo: [],
    }),
  ).toXDR("base64");
}

/**
 * Starts the RPC double on an ephemeral port.
 *
 * @param options - Behaviour and captured-response configuration.
 * @returns A handle carrying the base URL, a call log, and a shutdown function.
 */
export async function startSorobanRpcDouble(
  options: SorobanRpcDoubleOptions,
): Promise<SorobanRpcDouble> {
  const {
    networkPassphrase,
    latestLedger,
    minResourceFee = DEFAULT_MIN_RESOURCE_FEE,
    transactionStatus = "SUCCESS",
    sendStatus = "PENDING",
  } = options;

  const state: { calls: string[]; lastSubmittedHash: string | null } = {
    calls: [],
    lastSubmittedHash: null,
  };
  const metadataXdr = synthesizeLedgerCloseMeta(latestLedger.headerXdr);

  /**
   * Produces the `simulateTransaction` result for a submitted transaction envelope.
   *
   * @param transactionXdr - Base64 transaction envelope from the request.
   * @returns The JSON-RPC result object, success or error shaped.
   */
  function simulate(transactionXdr: string): Record<string, unknown> {
    const base = { id: "sim", latestLedger: latestLedger.sequence, events: [] as string[] };

    let transaction: Transaction;
    try {
      transaction = new Transaction(transactionXdr, networkPassphrase);
    } catch {
      return { ...base, error: "could not decode transaction" };
    }

    const operation = transaction.operations[0];
    if (!operation || operation.type !== "invokeHostFunction") {
      return { ...base, error: "HostError: transaction has no contract invocation" };
    }
    const invokeOp = operation as Operation.InvokeHostFunction;

    const authError = verifyAuthSignatures(invokeOp, networkPassphrase);
    if (authError !== null) {
      return { ...base, error: authError };
    }

    if (invokeOp.func.switch().name !== "hostFunctionTypeInvokeContract") {
      return { ...base, error: "HostError: unsupported host function" };
    }
    const invokeArgs = invokeOp.func.invokeContract();

    return {
      ...base,
      events: [buildTransferEvent(invokeArgs)],
      // A resource fee alone is enough: nothing on the verify path inspects the footprint,
      // and `assembleTransaction` only needs a decodable SorobanTransactionData.
      transactionData: new xdr.SorobanTransactionData({
        ext: new xdr.SorobanTransactionDataExt(0),
        resources: new xdr.SorobanResources({
          footprint: new xdr.LedgerFootprint({ readOnly: [], readWrite: [] }),
          instructions: 0,
          diskReadBytes: 0,
          writeBytes: 0,
        }),
        resourceFee: xdr.Int64.fromString(minResourceFee),
      }).toXDR("base64"),
      minResourceFee,
      results: [{ xdr: xdr.ScVal.scvVoid().toXDR("base64"), auth: [] }],
      stateChanges: [],
    };
  }

  /**
   * Dispatches one JSON-RPC method.
   *
   * @param method - The JSON-RPC method name.
   * @param params - The method parameters.
   * @returns The result object for the response.
   */
  function dispatch(method: string, params: Record<string, unknown>): Record<string, unknown> {
    state.calls.push(method);

    switch (method) {
      case "getHealth":
        return {
          status: "healthy",
          latestLedger: latestLedger.sequence,
          oldestLedger: latestLedger.sequence - 1000,
          ledgerRetentionWindow: 1000,
        };

      case "getLatestLedger":
        return { ...latestLedger, metadataXdr };

      case "getLedgerEntries": {
        // Settlement loads the submitter's account entry for its sequence number. Any
        // funded-looking account satisfies that; balances are not modelled.
        const keys = (params.keys ?? []) as string[];
        const entries = keys
          .map(key => {
            const ledgerKey = xdr.LedgerKey.fromXDR(key, "base64");
            if (ledgerKey.switch().name !== "account") return null;
            return {
              key,
              xdr: xdr.LedgerEntryData.account(
                new xdr.AccountEntry({
                  accountId: ledgerKey.account().accountId(),
                  balance: xdr.Int64.fromString("100000000000"),
                  seqNum: xdr.Int64.fromString("16872809087107072"),
                  numSubEntries: 0,
                  inflationDest: null,
                  flags: 0,
                  homeDomain: "",
                  thresholds: Buffer.from([1, 0, 0, 0]),
                  signers: [],
                  ext: new xdr.AccountEntryExt(0),
                }),
              ).toXDR("base64"),
              lastModifiedLedgerSeq: latestLedger.sequence,
            };
          })
          .filter(entry => entry !== null);
        return { entries, latestLedger: latestLedger.sequence };
      }

      case "simulateTransaction":
        return simulate(params.transaction as string);

      case "sendTransaction": {
        // The real hash of the real envelope, computed by the SDK — so the hash a test
        // sees in a SettleResponse is the one that transaction would actually have.
        const submitted = TransactionBuilder.fromXDR(params.transaction as string, networkPassphrase);
        state.lastSubmittedHash = submitted.hash().toString("hex");
        return {
          status: sendStatus,
          hash: state.lastSubmittedHash,
          latestLedger: latestLedger.sequence,
          latestLedgerCloseTime: latestLedger.closeTime,
        };
      }

      case "getTransaction":
        return {
          status: transactionStatus,
          txHash: state.lastSubmittedHash ?? "",
          latestLedger: latestLedger.sequence,
          latestLedgerCloseTime: latestLedger.closeTime,
          oldestLedger: latestLedger.sequence - 1000,
          oldestLedgerCloseTime: latestLedger.closeTime,
          ledger: latestLedger.sequence,
          createdAt: latestLedger.closeTime,
          applicationOrder: 1,
          feeBump: false,
          // Echoed back verbatim: the envelope the facilitator actually submitted.
          envelopeXdr: lastSubmittedEnvelope,
          resultXdr: new xdr.TransactionResult({
            feeCharged: xdr.Int64.fromString("23073"),
            result: xdr.TransactionResultResult.txSuccess([]),
            ext: new xdr.TransactionResultExt(0),
          }).toXDR("base64"),
          resultMetaXdr: new xdr.TransactionMeta(
            3,
            new xdr.TransactionMetaV3({
              ext: new xdr.ExtensionPoint(0),
              txChangesBefore: [],
              operations: [],
              txChangesAfter: [],
              sorobanMeta: null,
            }),
          ).toXDR("base64"),
        };

      default:
        throw new Error(`soroban-rpc-double: unhandled method '${method}'`);
    }
  }

  let lastSubmittedEnvelope: string | null = null;

  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", chunk => chunks.push(chunk as Buffer));
    request.on("end", () => {
      let id: unknown = null;
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          id: unknown;
          method: string;
          params?: Record<string, unknown>;
        };
        id = body.id;
        if (body.method === "sendTransaction") {
          lastSubmittedEnvelope = (body.params?.transaction as string) ?? null;
        }
        const result = dispatch(body.method, body.params ?? {});
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      } catch (error) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            error: { code: -32603, message: (error as Error).message },
          }),
        );
      }
    });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    get calls() {
      return state.calls;
    },
    get lastSubmittedHash() {
      return state.lastSubmittedHash;
    },
    get lastSubmittedEnvelope() {
      return lastSubmittedEnvelope;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve())),
      ),
  };
}

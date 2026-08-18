# Licensing

The repository is Apache-2.0, and the dependency tree is treated as part of the
deliverable. The pre-build scan of the full planned dependency set found 294
distinct packages, all permissive: zero AGPL or other strong copyleft, zero weak
copyleft, zero undeclared (docs/FACTS.md row F-060).

A full-tree scan now runs in continuous integration, two-tier, with its
exceptions printed rather than hidden (docs/DECISIONS.md entry D-031). Tier one,
the shipped path — every production dependency, transitively, of every workspace
package: zero tolerance — any copyleft or undeclared license fails the build. Tier two, the docs-build
toolchain (a diagram renderer that never ships and never serves): strong copyleft
still fails outright, while exactly three reviewed exceptions exist, each pinned
to an exact version with a rationale printed on every run — elkjs (EPL-2.0),
dompurify (MPL-2.0 OR Apache-2.0 dual license, Apache-2.0 elected), and khroma
(no license field in its manifest; its MIT license file is re-verified on disk on
every run) (docs/FACTS.md row F-084). A version bump of an excepted package
re-triggers review.

AGPL is excluded outright per the RFP: the OpenZeppelin Relayer path is
AGPL-3.0 and is neither used nor studied (docs/FACTS.md row F-015).

<!-- Generated from the function table. Do not edit by hand.
     Run: cd core && go test ./internal/analyzer -run TestFunctionCoverage -update-docs -->

# Terraform function coverage

Terraform's own function library lives under `internal/` and cannot be
imported ([ADR-0002](../adr/0002-go-wasm-analysis-core.md)), so this table is
assembled from public packages — cty's standard library and
`hashicorp/go-cty-funcs` — plus a handful written here where there was
nothing to borrow.

**Nothing is ever approximated.** A function that is not implemented reports
itself by name, with the reason, and the value becomes unknown. A subtly wrong
answer in a teaching tool teaches the wrong thing, which is worse than a gap
that says so.

## Supported (83)

- `abs`
- `alltrue`
- `anytrue`
- `base64decode`
- `base64encode`
- `bcrypt`
- `ceil`
- `chomp`
- `chunklist`
- `cidrhost`
- `cidrnetmask`
- `cidrsubnet`
- `cidrsubnets`
- `coalesce`
- `coalescelist`
- `compact`
- `concat`
- `contains`
- `csvdecode`
- `distinct`
- `element`
- `endswith`
- `flatten`
- `floor`
- `format`
- `formatdate`
- `formatlist`
- `indent`
- `join`
- `jsondecode`
- `jsonencode`
- `keys`
- `length`
- `log`
- `lookup`
- `lower`
- `max`
- `md5`
- `merge`
- `min`
- `one`
- `parseint`
- `pow`
- `range`
- `regex`
- `regexall`
- `replace`
- `reverse`
- `setintersection`
- `setproduct`
- `setsubtract`
- `setunion`
- `sha1`
- `sha256`
- `sha512`
- `signum`
- `slice`
- `sort`
- `split`
- `startswith`
- `strcontains`
- `strrev`
- `substr`
- `sum`
- `timeadd`
- `title`
- `tobool`
- `tolist`
- `tomap`
- `tonumber`
- `toset`
- `tostring`
- `transpose`
- `trim`
- `trimprefix`
- `trimspace`
- `trimsuffix`
- `upper`
- `urlencode`
- `uuid`
- `uuidv5`
- `values`
- `zipmap`

## Deliberately not supported

Each of these is a decision rather than an omission.

| Function | Why |
|---|---|
| `can` | tests whether an expression errors, which this analyzer reports instead |
| `defaults` | deprecated in Terraform and not implemented here |
| `file` | reads from disk, which the browser has no access to |
| `filebase64` | reads from disk, which the browser has no access to |
| `fileexists` | reads from disk, which the browser has no access to |
| `nonsensitive` | removes a sensitive marking, and nothing here tracks that marking |
| `pathexpand` | depends on the machine Terraform runs on |
| `sensitive` | marks a value sensitive, and nothing here tracks that marking |
| `templatefile` | reads a template from disk, which the browser has no access to |
| `timestamp` | changes on every run, so it has no fixed value here |
| `try` | catches evaluation errors, which this analyzer reports rather than swallows |
| `yamldecode` | not implemented yet |
| `yamlencode` | not implemented yet |

## Anything else

A function in neither list is one Terraform has and we have not reached. It
produces an evaluation error, and the attribute using it is reported as
unknown with the parser's own message.

That is the honest outcome, but it is a worse message than the table above
produces. Moving a function into the "not supported" list — with a reason a
learner can act on — is a small change and always an improvement, even when
implementing it is not yet possible.

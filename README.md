# Doppler Secrets Fetch Action

This action enables you to fetch Doppler secrets for use in your GitHub Actions.

> NOTE: If the GitHub Actions for your repository only require secrets from a single config, we recommend using our [Doppler GitHub application](https://github.com/apps/doppler-secretops-platform/) instead, as it syncs secrets directly to your repository.

## Configuration

The action can be configured in two ways:

* Service Account with Project and Config via either:
  - Service Account Identity via OIDC (recommended)
  - Service Account Token
* Service Token

### Service Account 

A Doppler Service Account allows for a configurable set of permissions to services in your workplace. A project and config must be specified when using a service account. Your workplace must be on the Team or Enterprise plan in order to use service accounts.

#### Service Account Identity via OIDC

[Identities](https://docs.doppler.com/docs/service-account-identities) allow a service account to authenticate to Doppler via OIDC without using a static API token. This method works like the Service Account Token method below but without a static API token.

The `auth-method`, `doppler-identity-id`, `doppler-project` and `doppler-config` inputs must be provided when using a Service Account Identity. The permission `id-token: write` is required so that Doppler can obtain an OIDC token from Github for authentication.

```yaml
jobs:
  your-example-job:
    permissions:
      id-token: write # required for obtaining the OIDC JWT from Github
    steps:
      - uses: dopplerhq/secrets-fetch-action@v2.0.0
          id: doppler
          with:
            auth-method: oidc        
            doppler-identity-id: <your-service-account-identity-uuid> 
            doppler-project: auth-api
            doppler-config: ci-cd
```

#### Service Account Token

 The `doppler-project` and `doppler-config` inputs must be provided when using a Service Account Token:

```yaml
- uses: dopplerhq/secrets-fetch-action@v2.0.0
      id: doppler
      with:
        doppler-token: ${{ secrets.DOPPLER_TOKEN }}
        doppler-project: auth-api
        doppler-config: ci-cd
```

### Service Token

A [Doppler Service Token](https://docs.doppler.com/docs/service-tokens) provides read-only access to a single config.

Create a GitHub repository secret named `DOPPLER_TOKEN` or if using multiple Service Tokens (e.g. for a Monorepo), you can prefix the secret name using with application name, e.g. `AUTH_API_DOPPLER_TOKEN`.

Then supply the Service Token using the `doppler-token` input:

```yaml
- uses: dopplerhq/secrets-fetch-action@v2.0.0
      id: doppler
      with:
        doppler-token: ${{ secrets.DOPPLER_TOKEN }}
```

## Usage

Secrets can be accessed in two ways:

- Default: Using `outputs`
- Optional: Using environment variables

### Using Outputs

Secrets can be accessed individually using `outputs` by providing an `id` for the Doppler action step:

```yaml
name: Doppler secrets from outputs

on: [push]

jobs:
  secrets-fetch:
    runs-on: ubuntu-latest
    steps:
    - uses: dopplerhq/secrets-fetch-action@v2.0.0
      id: doppler
      with:
        doppler-token: ${{ secrets.DOPPLER_TOKEN }}
    - run: echo "DOPPLER_PROJECT is ${{ steps.doppler.outputs.DOPPLER_PROJECT }} (Doppler meta environment variables are unmasked)"
    - run: echo "API_KEY is ${{ steps.doppler.outputs.API_KEY }} (secret masked output)"
```

### Using Environment Variables

This option injects secrets as environment variables for use in subsequent steps by setting the `inject-env-vars` input to `true`.

> NOTE: Be careful using this option as environment variables are available to any subsequent process in your GitHub Action steps.

```yaml
name: Doppler secrets from environment variables

on: [push]

jobs:
  secrets-fetch:
    runs-on: ubuntu-latest
    steps:
    - uses: dopplerhq/secrets-fetch-action@v2.0.0
      id: doppler
      with:
        doppler-token: ${{ secrets.DOPPLER_TOKEN }}
        inject-env-vars: true
    - run: printenv
```

## Secret Names

> **Beta:** Secret names beyond `UPPER_SNAKE_CASE` are currently in beta access and are not yet
> generally available. Unless your workplace has been enrolled in the beta, secret names are still
> restricted to uppercase letters, digits, and underscores, cannot begin with a digit, and none of
> the guidance below applies to you.

For workplaces in the beta, Doppler allows secret names beyond the traditional `UPPER_SNAKE_CASE`
convention, including lowercase letters, dashes, and forward slashes. Every such secret is fetched,
masked, and set, but not all of them can be read with the plain syntax shown above.

| Name | `outputs` | Environment variable |
| --- | --- | --- |
| `API_KEY`, `api_key` | `outputs.API_KEY` | `$API_KEY` |
| `MY-SECRET` | `outputs.MY-SECRET` | `printenv 'MY-SECRET'` |
| `MY/SECRET`, `MY.SECRET`, `2FA_TOKEN` | `outputs['MY/SECRET']` | `printenv 'MY/SECRET'` |

Two cases are worth calling out:

- **Dashes work in outputs but not in shells.** `${{ steps.doppler.outputs.MY-SECRET }}` is valid,
  for the same reason `steps.setup-node.outputs.node-version` is. But in a `run:` step, `$MY-SECRET`
  expands to the empty `$MY` followed by the literal `-SECRET`, producing a wrong value rather than
  an error. Use `printenv 'MY-SECRET'` or `${{ env['MY-SECRET'] }}`.
- **Names differing only by case collide on Windows.** `api_key` and `API_KEY` are distinct
  environment variables on Linux and macOS, but the same one on Windows runners. The action fails
  the step when it detects this on Windows.

The action logs a grouped warning describing any name that needs special handling. Use the
`on-invalid-name` input to change that behavior:

```yaml
- uses: dopplerhq/secrets-fetch-action@v2.0.0
  id: doppler
  with:
    doppler-token: ${{ secrets.DOPPLER_TOKEN }}
    inject-env-vars: true
    on-invalid-name: warn # warn (default) | error | skip
```

| Value | Behavior |
| --- | --- |
| `warn` | Set the secret anyway and log how to read it. The default, and never fails a build. |
| `error` | Fail the step, listing every affected name. |
| `skip` | Omit the affected output or environment variable, and set the rest. |

Names containing a newline, carriage return, null byte, or `=` cannot be written to
`$GITHUB_ENV` or `$GITHUB_OUTPUT` without corrupting them. Those are always skipped and always
fail the step, regardless of `on-invalid-name`. Their values are still masked.

## Automatic Secrets Masking

All secret values are masked with the exception of the Doppler meta variables:

- `DOPPLER_PROJECT`
- `DOPPLER_ENVIRONMENT`
- `DOPPLER_CONFIG`

and any secrets assigned the `unmasked` [secret visibility](https://docs.doppler.com/docs/secret-visibility).

# Development and Testing

Export the `NODE_ENV` and `DOPPLER_TOKEN` environment variables, then run `pnpm test`.

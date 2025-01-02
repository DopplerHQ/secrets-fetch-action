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
      - uses: dopplerhq/secrets-fetch-action@v1.3.0
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
- uses: dopplerhq/secrets-fetch-action@v1.3.0
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
- uses: dopplerhq/secrets-fetch-action@v1.3.0
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
    - uses: dopplerhq/secrets-fetch-action@v1.3.0
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
    - uses: dopplerhq/secrets-fetch-action@v1.3.0
      id: doppler
      with:
        doppler-token: ${{ secrets.DOPPLER_TOKEN }}
        inject-env-vars: true
    - run: printenv
```

## Automatic Secrets Masking

All secret values are masked with the exception of the Doppler meta variables:

- `DOPPLER_PROJECT`
- `DOPPLER_ENVIRONMENT`
- `DOPPLER_CONFIG`

and any secrets assigned the `unmasked` [secret visibility](https://docs.doppler.com/docs/secret-visibility).

# Development and Testing

Export the `NODE_ENV` and `DOPPLER_TOKEN` environment variables, then run `npm test`.

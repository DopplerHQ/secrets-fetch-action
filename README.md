# Doppler Secrets Fetch Action

This action enables you to fetch Doppler secrets for use in your GitHub Actions.

> NOTE: If the GitHub Actions for your repository only require secrets from a single config, we recommend using our [Doppler GitHub application](https://github.com/apps/doppler-secrets-manager/) instead, as it syncs secrets directly to your repository.

## Configuration

The action can be configured in two ways:

* Service Token (recommended)
* Personal Token with Project and Config

### Service Token

A [Doppler Service Token](https://docs.doppler.com/docs/service-tokens) provides read-only access to a single config and is recommended due to its limited access scope.

Create a GitHub repository secret named `DOPPLER_TOKEN` or if using multiple Service Tokens (e.g. for a Monorepo), you can prefix the secret name using with application name, e.g. `AUTH_API_DOPPLER_TOKEN`.

Then supply the Service Token using the `doppler-token` input:

```yaml
- uses: dopplerhq/secrets-fetch-action@v1.1.1
      id: doppler
      with:
        doppler-token: ${{ secrets.DOPPLER_TOKEN }}
```

### Personal Token

A Doppler Personal Token provides read/write access to every Project and Config accessible for that account and should only be used when necessary. The `doppler-project` and `doppler-config` inputs must be provided when using a Personal Token:

```yaml
- uses: dopplerhq/secrets-fetch-action@v1.1.1
      id: doppler
      with:
        doppler-token: ${{ secrets.PERSONAL_DOPPLER_TOKEN }}
        doppler-project: auth-api
        doppler-config: ci-cd
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
    - uses: dopplerhq/secrets-fetch-action@v1.1.1
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
    - uses: dopplerhq/secrets-fetch-action@v1.1.1
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

# Development and Testing

Export the `NODE_ENV` and `DOPPLER_TOKEN` environment variables, then run `npm test`.

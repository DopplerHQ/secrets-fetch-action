# Doppler Secrets Fetch Action

This action enables you to fetch Doppler secrets for use in your GitHub Actions.

> NOTE: If the GitHub Actions for your repository only require secrets from a single config, we recommend using our [Doppler GitHub application](https://github.com/apps/doppler-secrets-manager/) instead, as it syncs secrets directly to your repository.

## Configuration

This action requires a [Doppler Service Token](https://docs.doppler.com/docs/service-tokens) to provide read-only access to secrets for a specific Config within a [Project](https://docs.doppler.com/docs/create-project).

Create a GitHub repository secret named `DOPPLER_TOKEN` or if using multiple Service Tokens (e.g. for a Monorepo), you can prefix the secret name using with application name, e.g. `AUTH_API_DOPPLER_TOKEN`.

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
    - uses: doppleruniversity/secrets-fetch-action@v1
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
    - uses: doppleruniversity/secrets-fetch-action@v0.0.1
      id: doppler
      with:
        doppler-token: ${{ secrets.DOPPLER_TOKEN }}
        inject-env-vars: true
    - run: echo "DOPPLER_PROJECT is ${{ env.DOPPLER_PROJECT }} (Doppler meta environment variables are unmasked)"
    - run: echo "API_KEY is ${{ env.API_KEY }}  (secret masked output)"
```

## Automatic Secrets Masking

All secret values are masked with the exception of the Doppler meta variables:

- `DOPPLER_PROJECT`
- `DOPPLER_ENVIRONMENT`
- `DOPPLER_CONFIG`
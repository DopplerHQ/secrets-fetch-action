# Doppler Secrets Fetch Action

Fetch Doppler secrets as outputs to use in your GitHub Actions.

## Usage

```yaml
name: Doppler Secrets Fetch

on: [push]

jobs:
  secrets-fetch:
    runs-on: ubuntu-latest
    steps:
    - uses: doppleruniversity/secrets-fetch-action@v0.0.1
      id: doppler
      with:
        doppler-token: ${{ secrets.DOPPLER_TOKEN }}
    - run: echo "DOPPLER_PROJECT is ${{ steps.doppler.outputs.DOPPLER_PROJECT }} (Doppler meta environment variables are unmasked)"
    - run: echo "API_KEY is ${{ steps.doppler.outputs.API_KEY }} (secret masked output)"
```

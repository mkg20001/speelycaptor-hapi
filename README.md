# speelycaptor-hapi

[Mozilla Spellycaptor AWS Lambada](https://github.com/mozilla/speelycaptor) without the AWS Lambada

# what is this?

This is a rewritten version of the Speelycaptor server.

Instead of using S3, temporary files are created with randomly generated names.

The S3 upload URL is handled over a /push/$file endpoint

# how to use?

First create a `config.yaml`

```yaml
hapi:
  port: 1234 # choose your own and put it behind a reverse proxy
externalUrl: 'https://speelycaptor.your-server.tld' # put the external URL (behind reverse proxy) here
# optional: put the temporary files somewhere else
# tmpFolder: '/storage/speelycaptor-tmp'
```

Then run the server `node src/bin.js`

(for production `npm i -g speelycaptor-hapi` and store config in `/etc/speelycaptor.yaml`)

# nixOS

We support nixOS!

Add it to your flake like so

```
inputs.speelycaptor.url = "github:mkg20001/speelycaptor-hapi/master";
```

And use the module

```
{ ... , speelycaptor }:
  ...
  modules = [
    speelycaptor.nixosModules.speelycaptor
    ({ ... }: {
      nixpkgs.overlays = [ speelycaptor.overlay ];
      services.speelycaptor.enable = true;
    })
  ];
  ...
```

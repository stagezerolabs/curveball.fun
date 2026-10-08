# Browser-safe IPFS metadata uploads

## Goal

Upload a token image and JSON metadata from the launch flow, then submit the
metadata CID on-chain as an `ipfs://` URI.

## Findings

- IPFS content must be pinned by a reliable node or pinning service to remain
  available. A browser alone is not a reliable provider. [IPFS persistence](https://docs.ipfs.tech/concepts/persistence/)
- The canonical on-chain value should be the metadata URI, such as
  `ipfs://<metadata-cid>`. The metadata JSON should reference the image as
  `ipfs://<image-cid>`. [IPFS metadata guidance](https://docs.ipfs.tech/how-to/best-practices-for-nft-data/)
- Pinata supports a free plan, but its API key must stay server-side. Browser
  uploads should use a short-lived signed URL created by a secure server.
  [Pinata signed uploads](https://pinata.cloud/blog/how-to-upload-to-ipfs-with-presigned-urls/)
  [Pinata pricing](https://pinata.cloud/pricing)
- Storacha can calculate CIDs and upload directly in the browser without an app
  secret, but each user must authorize the browser agent and use a storage
  space. [Storacha upload service](https://github.com/storacha/upload-service)

## Recommendation

Use Pinata signed uploads for the shortest launch UX. Add one authenticated
serverless endpoint that returns a short-lived upload URL; never expose the
Pinata JWT in Vite environment variables. Upload the image first, build the JSON
metadata with its `ipfs://` image URI, upload the JSON, then place
`ipfs://<metadata-cid>` in the launch form's `uri` field.

If the app must remain entirely static, use Storacha user-owned authorization.
That avoids a project secret but adds an email authorization step to the launch
flow.

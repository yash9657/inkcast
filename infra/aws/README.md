# Inkcast render service on AWS Lambda

```
studio (Vercel, apps/web) ── POST /run, bearer ──▶ Lambda Function URL (RESPONSE_STREAM)
                                                    │
                       render-service container (Dockerfile.lambda, arm64, 10 GB / 6 vCPU)
                                                    │
                                Vercel Blob (job.json, out.mp4, …) — unchanged
```

The studio stays on Vercel; only `INKCAST_RENDER_URL` changes. State lives in the same
`tfstate-481912007673-use1` bucket as tally (`inkcast/terraform.tfstate`).

| Choice | Reason |
|---|---|
| Lambda container image, not Vercel container | 6 vCPU / 10 GB instead of 2 / 4: five capture workers instead of two, and Kokoro/Whisper get real cores. |
| Lambda Web Adapter | The existing HTTP server runs unchanged; `/run` keeps its bearer check and NDJSON reply. |
| One request per instance | Lambda's own model, so the studio's `503 busy` retry path no longer fires. |
| No CloudFront | Server-to-server only; nobody needs a custom domain for it. |

## First-time setup

```bash
# 1. secrets, copied from the Vercel inkcast-render project
vercel env pull /tmp/render.env --environment production   # in a dir linked to inkcast-render
set -a; . /tmp/render.env; set +a
aws secretsmanager create-secret --region us-east-1 --name inkcast/render --secret-string \
  "$(jq -n --arg b "$BLOB_READ_WRITE_TOKEN" --arg t "$INKCAST_RENDER_TOKEN" '{BLOB_READ_WRITE_TOKEN:$b,INKCAST_RENDER_TOKEN:$t}')"
rm /tmp/render.env

# 2. ECR + role, then image + function
terraform init && terraform apply
./deploy.sh
```

## Cutover

1. `curl $(terraform output -raw function_url)health` → `{"ok":true,...}`.
2. Point the studio at it and redeploy:
   `vercel env rm INKCAST_RENDER_URL production` then `vercel env add INKCAST_RENDER_URL production`
   (value: the function URL) in a dir linked to the `inkcast` project.
3. Render one film; compare `cast finished: …` in CloudWatch (`/aws/lambda/inkcast-render`)
   against the Vercel log line. Keep the Vercel `inkcast-render` project until a day runs clean.

Rollback: set `INKCAST_RENDER_URL` back to the Vercel render URL.

## Deploys

`./deploy.sh` builds both images, pushes `<sha>` to ECR (immutable tags) and applies.

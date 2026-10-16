# Inkcast render on AWS Fargate

```
studio (Vercel, apps/web) ── seal request → Blob run.sealed ── ecs:RunTask (Vercel OIDC role)
                                                                     │
               Fargate task, one per film: Dockerfile.vercel image, src/task.ts, 8 vCPU / 16 GB arm64
                                                                     │
                                  Vercel Blob (job.json progress, out.mp4, …) — unchanged
```

The studio stays on Vercel. With `INKCAST_RENDER_ECS` set it starts a task and returns
instead of holding `POST /run` open; the task writes `job.json` and `store.ts` reconciles
the project record from it. Without the variable the HTTP renderer path is unchanged.

| Choice | Reason |
|---|---|
| Fargate, not Lambda | The account caps Lambda at 3008 MB (new-account limit, AWS Support only). Fargate allows 16 vCPU and has 30 vCPU of quota today. |
| One task per film, pay per film | About $0.03 a film; nothing runs while idle. |
| Request sealed in Blob | ECS overrides cap at 8 KB; the request carries provider keys, so it is AES-256-GCM sealed under `INKCAST_RENDER_TOKEN` and deleted by the task on read. |
| Vercel OIDC role | No AWS key on Vercel. The role trusts only `inkcast` production and may only `RunTask` this family on this cluster. |
| Public subnet + public IP, no inbound | The 0.9 GB image pulls through the internet gateway, not the shared NAT instance. |

## First-time setup

```bash
# 1. secrets (done 2026-10-15): inkcast/render with BLOB_READ_WRITE_TOKEN, INKCAST_RENDER_TOKEN
# 2. ECR, roles, cluster; then image + task definition
terraform init && terraform apply -auto-approve
./deploy.sh -auto-approve
```

## Cutover

1. `terraform output -raw render_ecs` → set it as `INKCAST_RENDER_ECS` on the Vercel
   `inkcast` project (production) and redeploy the studio from this branch.
2. Render one film; the first takes about a minute longer while the task starts. Compare
   `cast finished: …` in CloudWatch (`/ecs/inkcast-render`) with the Vercel log line.
3. Keep the Vercel `inkcast-render` project until a day runs clean.

## Shipping renderer or planner changes

The lesson, voice and render stages all run in the task, so a merge to `main` reaches films
only after a new image: `./deploy.sh -auto-approve` from an up-to-date `main`. The studio
names the task family, so it picks up the new revision with no Vercel change. (The studio
itself deploys to production from the `deploy/vercel` branch, not `main`.)

Rollback: remove `INKCAST_RENDER_ECS` and redeploy; the studio goes back to `INKCAST_RENDER_URL`.

## Not covered

- No alarm on failed tasks: a failed film already shows as an error in the studio.
- A task that dies without writing `job.json` is caught by the 3-minute staleness rule.

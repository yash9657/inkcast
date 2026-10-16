/**
 * Start one Fargate render task (infra/aws). Configured by `INKCAST_RENDER_ECS`, the
 * stack's `render_ecs` output: cluster, task definition, subnets, security group and
 * the role this deployment assumes through Vercel OIDC — no long-lived AWS key.
 */

import { ECSClient, RunTaskCommand } from '@aws-sdk/client-ecs';
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider';

type EcsConfig = {
  region: string;
  cluster: string;
  taskDefinition: string;
  container: string;
  subnets: string[];
  securityGroups: string[];
  roleArn: string;
};

export function ecsConfig(): EcsConfig | undefined {
  const raw = process.env.INKCAST_RENDER_ECS?.trim();
  return raw ? (JSON.parse(raw) as EcsConfig) : undefined;
}

let client: ECSClient | undefined;

/** Resolves once ECS has accepted the task; the task itself reports through `job.json`. */
export async function runRenderTask(config: EcsConfig, runBlob: string): Promise<void> {
  client ??= new ECSClient({
    region: config.region,
    credentials: awsCredentialsProvider({ roleArn: config.roleArn }),
  });
  const out = await client.send(
    new RunTaskCommand({
      cluster: config.cluster,
      taskDefinition: config.taskDefinition,
      launchType: 'FARGATE',
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: config.subnets,
          securityGroups: config.securityGroups,
          assignPublicIp: 'ENABLED',
        },
      },
      overrides: {
        containerOverrides: [
          { name: config.container, environment: [{ name: 'INKCAST_RUN_BLOB', value: runBlob }] },
        ],
      },
    }),
  );
  if (!out.tasks?.length) {
    throw new Error(out.failures?.map((f) => f.reason).join('; ') || 'ECS started no task');
  }
}

/**
 * The settings feature surface.
 *
 * `catalog` is exported because the API routes read it too — it is the shared
 * description of what each key does. `client` is deliberately *not* re-exported:
 * the only module that may post a credential should have to be imported by name.
 */

export {
  MANAGED_ENV_VARS,
  PROVIDERS,
  PROVIDER_IDS,
  STAGE_LABEL,
  isProviderId,
  judgeKeyShape,
  maskSecret,
  providerInfo,
  type ProviderId,
  type ProviderInfo,
  type ProviderStage,
  type ShapeRule,
  type ShapeVerdict,
} from './catalog';
export { KeysPanel } from './keys-panel';
export { ProviderCard, type ProviderCardProps } from './provider-card';

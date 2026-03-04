export {
  UIActionRegistryProvider,
  useUIActionRegistry,
  useRegisterUIAction,
  useRegisterViewModeAction,
  useRegisterTabSwitchAction,
  useRegisterSubmitAction,
} from './UIActionRegistry';
export type { UIAction, UIActionParam } from './UIActionRegistry';

export {
  FormFieldRegistryProvider,
  useFormFieldRegistry,
  useRegisterFormField,
} from './FormFieldRegistry';
export type { FormField, FormFieldType, FormFieldOption } from './FormFieldRegistry';

export { default as CopilotProvider } from './CopilotProvider';
export { useProgressiveFields } from './useProgressiveFields';
export type { ProgressiveFieldConfig, ProgressiveStepConfig } from './useProgressiveFields';
export { createClientToolHandler } from './clientToolHandlers';

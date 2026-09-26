/**
 * Compatibility shim. The workbench talks to a runtime abstraction (~/lib/runtime/container):
 * the LuxCoder local runtime by default, StackBlitz WebContainer only when selected.
 * These names are kept for older imports; new code should import from ~/lib/runtime/container.
 */
export {
  runtime as webcontainer,
  ensureRuntimeBoot as ensureWebContainerBoot,
  runtimeContext as webcontainerContext,
} from '~/lib/runtime/container';

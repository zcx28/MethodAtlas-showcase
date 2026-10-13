// The native SDK omits tool_choice; compatible gateways can require the default explicitly.
export const name = 'methodatlas-auto-tools';
export const inject = ['deepseekLlmApiExtensions'];
export async function apply(ctx) {
  ctx.deepseekLlmApiExtensions.register('tool_choice', {
    prepare: ({ body }) => body.tools?.length ? { value: 'auto' } : undefined,
  });
}

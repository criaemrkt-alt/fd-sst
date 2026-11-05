// Node 24 runs the same TypeScript worker modules without downloading a second
// dependency tree. Production imports remain pinned Deno npm: specifiers.
import {registerHooks} from 'node:module'
import {test} from 'node:test'
registerHooks({resolve(specifier,context,next){
 if(specifier==='https://deno.land/x/imagescript@1.2.15/mod.ts')specifier='imagescript'
 if(specifier.startsWith('npm:'))specifier=specifier.slice(4).replace(/@\d[^/]*$/,'')
 return next(specifier,context)
}})
globalThis.Deno={test}
await import('../supabase/functions/photo-report-worker/worker_test.ts')

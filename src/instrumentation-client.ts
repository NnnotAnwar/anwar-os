// Runs in the browser before the app's own code (Next instrumentation-client).
import { config } from "zod"

// zod compiles object parsers with `new Function` unless told not to, and
// probes for that with a try/catch the first time a schema is built. Our CSP has
// no 'unsafe-eval', so the probe fails harmlessly but still raises a CSP
// violation on every page. jitless skips the probe and the compiler; client-side
// parsing is small enough that the interpreter is just as fast.
config({ jitless: true })

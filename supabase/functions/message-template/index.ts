import { serveAuthenticated } from "../_shared/serve.ts";
import { WaxError } from "../_shared/errors.ts";

serveAuthenticated(() => {
  throw new WaxError("not_implemented", "message-template is not implemented yet");
});

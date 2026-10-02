// Nasaq's FieldError/FieldDescription are Base UI Field parts: they throw outside a <Field>, and
// FieldError only shows when the control itself is invalid. Mahaam's form-level messages (a server
// error under a whole form, a hint under a grid of fields) need plain text with the same look.
import { cn } from "@fadymondy/nasaq/web"

export function FormError({ className, ...props }: React.ComponentProps<"p">) {
  return <p role="alert" data-slot="field-error" className={cn("text-caption text-nq-danger-text", className)} {...props} />
}

export function FormHint({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="field-description" className={cn("text-caption text-muted-foreground", className)} {...props} />
}

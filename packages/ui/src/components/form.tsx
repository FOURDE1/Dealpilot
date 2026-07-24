import {
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useId,
  type HTMLAttributes,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';
import { cn } from '../lib/cn.js';
import { Label } from './field.js';

/**
 * react-hook-form composition on the field primitives (H-05). Wires label,
 * control, hint and error together with real aria plumbing (ids,
 * aria-describedby, aria-invalid) — the a11y contract ui-design-system §8
 * requires. `Form` is RHF's FormProvider; validation resolvers (zodResolver
 * with @dealpilot/schemas) are passed by the caller's useForm.
 */
export const Form = FormProvider;

interface FieldContextValue {
  name: string;
  id: string;
}
const FieldContext = createContext<FieldContextValue | null>(null);

function useField() {
  const ctx = useContext(FieldContext);
  if (!ctx) throw new Error('Form.* components must be inside <FormField>');
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: ctx.name });
  const state = getFieldState(ctx.name, formState);
  return {
    ...ctx,
    error: state.error,
    hintId: `${ctx.id}-hint`,
    errorId: `${ctx.id}-error`,
  };
}

export function FormField<
  TValues extends FieldValues,
  TName extends FieldPath<TValues>,
  TTransformedValues = TValues,
>(props: ControllerProps<TValues, TName, TTransformedValues>) {
  const id = useId();
  return (
    <FieldContext.Provider value={{ name: props.name, id }}>
      <Controller {...props} />
    </FieldContext.Provider>
  );
}

export function FormItem({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-1', className)} {...props} />;
}

export function FormLabel(props: LabelHTMLAttributes<HTMLLabelElement>) {
  const { id } = useField();
  return <Label htmlFor={id} {...props} />;
}

/** Clones its single child control, attaching the field's id + aria wiring. */
export function FormControl({ children, hasHint }: { children: ReactNode; hasHint?: boolean }) {
  const { id, error, hintId, errorId } = useField();
  if (!isValidElement(children)) throw new Error('FormControl needs a single element child');
  const describedBy =
    [hasHint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;
  return cloneElement(children as ReactElement<Record<string, unknown>>, {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
  });
}

export function FormHint({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const { hintId } = useField();
  return <p id={hintId} className={cn('text-xs text-muted-foreground', className)} {...props} />;
}

/** Renders the field's validation error (localized message from the resolver). */
export function FormMessage({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const { error, errorId } = useField();
  if (!error?.message) return null;
  return (
    <p id={errorId} role="alert" className={cn('text-sm text-danger-text', className)} {...props}>
      {String(error.message)}
    </p>
  );
}

import { useState, useCallback } from 'react';

// Form values are heterogeneous by nature (strings, numbers, arrays,
// nested selections). Rule callbacks receive `unknown` and cast inside
// the closure — the hook itself is generic over the whole form shape
// so callers pass their typed form data without extra casts.
type Rules<TForm> = Record<string, (value: unknown, form: TForm) => string | null>;

export function useFormValidation<TForm extends object = object>(rules: Rules<TForm>) {
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const validateField = useCallback((field: string, value: unknown, form: TForm) => {
    const rule = rules[field];
    if (!rule) return null;
    const error = rule(value, form);
    setErrors((prev) => ({ ...prev, [field]: error || undefined }));
    return error;
  }, [rules]);

  const touch = useCallback((field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  const validateAll = useCallback((form: TForm): boolean => {
    const nextErrors: Record<string, string | undefined> = {};
    const nextTouched: Record<string, boolean> = {};
    let valid = true;
    for (const field of Object.keys(rules)) {
      nextTouched[field] = true;
      const error = rules[field]((form as Record<string, unknown>)[field], form);
      if (error) { nextErrors[field] = error; valid = false; }
    }
    setErrors(nextErrors);
    setTouched(nextTouched);
    return valid;
  }, [rules]);

  const clearErrors = useCallback(() => {
    setErrors({});
    setTouched({});
  }, []);

  const fieldError = (field: string): string | undefined => {
    return touched[field] ? errors[field] : undefined;
  };

  return { errors, touched, validateField, touch, validateAll, clearErrors, fieldError };
}

export const fieldErrorStyle: React.CSSProperties = {
  fontSize: 11, color: '#dc2626', marginTop: 3,
};

export const inputErrorBorder = '1px solid #fca5a5';

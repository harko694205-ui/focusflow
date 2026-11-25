import { clsx, type ClassValue } from 'clsx';

/** Class-name joiner. Tokens are strict, so no merge step is needed. */
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

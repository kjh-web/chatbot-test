'use client';

import React from 'react';
import { useFormStatus } from 'react-dom';

import { LoaderIcon } from '@/components/icons';
import { Button } from './ui/button';

export function SubmitButton({
  children,
  isSuccessful,
  disabled,
}: {
  children: React.ReactNode;
  isSuccessful: boolean;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const isDisabled = pending || isSuccessful || disabled;

  return (
    <Button
      type={pending ? 'button' : 'submit'}
      aria-disabled={isDisabled}
      disabled={isDisabled}
      className="relative"
    >
      {children}

      {(pending || isSuccessful) && (
        <span className="animate-spin absolute right-4">
          <LoaderIcon />
        </span>
      )}

      <output aria-live="polite" className="sr-only">
        {pending || isSuccessful ? '로딩 중' : '양식 제출'}
      </output>
    </Button>
  );
}
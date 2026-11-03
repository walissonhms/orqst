import { useEffect, useRef, type ReactNode } from 'react';

/** Native modal containment, Escape and focus restoration shared by shell overlays. */
export function Modal({
  label,
  className,
  initialFocus,
  onClose,
  children,
}: {
  label: string;
  className: string;
  initialFocus?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement;
    const dialog = ref.current;
    dialog?.showModal();
    if (initialFocus) dialog?.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [initialFocus]);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      {children}
    </dialog>
  );
}

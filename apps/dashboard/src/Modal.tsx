import { useEffect, useRef, type ReactNode } from 'react';

/** Native dialog presentation, Escape handling and focus restoration. */
export function Modal({
  label,
  className,
  initialFocus,
  nativeOverlay,
  nonModal = false,
  descriptionId,
  onClose,
  children,
}: {
  label: string;
  className: string;
  initialFocus?: string;
  nativeOverlay?: boolean;
  nonModal?: boolean;
  descriptionId?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement;
    const dialog = ref.current;
    if (nonModal) dialog?.show();
    else dialog?.showModal();
    if (initialFocus) dialog?.querySelector<HTMLElement>(initialFocus)?.focus();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, [initialFocus, nonModal]);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={label}
      aria-describedby={descriptionId}
      data-native-overlay={nativeOverlay ? '' : undefined}
      onKeyDown={(event) => {
        if (nonModal && event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
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

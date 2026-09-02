"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function DialogShell({
  open,
  title,
  personName,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  personName: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    if (open && !node.open) {
      node.showModal();
    }
    if (!open && node.open) {
      node.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="m-auto w-full max-w-md rounded-lg border bg-background p-4 text-foreground shadow-lg"
      onClose={onClose}
      onCancel={onClose}
    >
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{personName}</p>
      {children}
    </dialog>
  );
}

export function ApplicationRefDialog({
  open,
  personName,
  initialRef,
  onClose,
  onSubmit,
}: {
  open: boolean;
  personName: string;
  initialRef: string;
  onClose: () => void;
  onSubmit: (applicationRef: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialRef);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initialRef);
    }
  }, [initialRef, open]);

  return (
    <DialogShell
      open={open}
      title="Applied"
      personName={personName}
      onClose={onClose}
    >
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const next = value.trim();
          if (!next || saving) {
            return;
          }
          setSaving(true);
          void onSubmit(next)
            .then(onClose)
            .finally(() => setSaving(false));
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="applicationRef">Application ref</Label>
          <Input
            id="applicationRef"
            required
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving || !value.trim()}>
            Save
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

export function CloseReasonDialog({
  open,
  personName,
  onClose,
  onSubmit,
}: {
  open: boolean;
  personName: string;
  onClose: () => void;
  onSubmit: (closeReason: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setValue("");
    }
  }, [open]);

  return (
    <DialogShell
      open={open}
      title="Reject"
      personName={personName}
      onClose={onClose}
    >
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const next = value.trim();
          if (!next || saving) {
            return;
          }
          setSaving(true);
          void onSubmit(next)
            .then(onClose)
            .finally(() => setSaving(false));
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="closeReason">Reason</Label>
          <textarea
            id="closeReason"
            required
            rows={3}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving || !value.trim()}>
            Reject
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

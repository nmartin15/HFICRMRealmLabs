"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function NoteDialog({
  open,
  personName,
  onClose,
  onSave,
}: {
  open: boolean;
  personName: string;
  onClose: () => void;
  onSave: (text: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    if (open && !node.open) {
      setText("");
      node.showModal();
    }
    if (!open && node.open) {
      node.close();
    }
  }, [open]);

  async function submit() {
    const value = text.trim();
    if (!value || saving) {
      return;
    }
    setSaving(true);
    try {
      await onSave(value);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="m-auto w-full max-w-md rounded-lg border bg-background p-4 text-foreground shadow-lg"
      onClose={onClose}
      onCancel={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-sm font-medium">Add note</h2>
        <p className="mt-1 text-sm text-muted-foreground">{personName}</p>
        <div className="mt-3 space-y-1">
          <Label htmlFor="note-text">Note</Label>
          <textarea
            id="note-text"
            autoFocus
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className="w-full rounded-lg border border-input bg-background px-2.5 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving || !text.trim()}>
            Save
          </Button>
        </div>
      </form>
    </dialog>
  );
}

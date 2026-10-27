"use client";

import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export function SelectMenu({
  label,
  value,
  onChange,
  options,
  className,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  disabled?: boolean;
}) {
  const index = options.findIndex((option) => option.value === value);
  return (
    <Select.Root
      value={index < 0 ? "" : String(index)}
      onValueChange={(key) => {
        const option = options[Number(key)];
        if (option) onChange(option.value);
      }}
      disabled={disabled}
    >
      <Select.Trigger
        aria-label={label}
        className={cn("choice-trigger", className)}
        data-active={value !== ""}
      >
        <Select.Value placeholder={label} />
        <Select.Icon>
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          className="choice-popup"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
        >
          <Select.Viewport>
            {options.map((option, i) => (
              <Select.Item
                key={option.value}
                value={String(i)}
                className="choice-option"
              >
                <Select.ItemText>{option.label}</Select.ItemText>
                <Select.ItemIndicator>
                  <Check size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

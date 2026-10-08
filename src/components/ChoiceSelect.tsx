import { Select } from "@base-ui/react/select";

type Option<T extends string> = { value: T; label: string };

export function ChoiceSelect<T extends string>({
  label,
  name,
  value,
  defaultValue,
  options,
  onValueChange,
  className = "",
}: {
  label: string;
  name?: string;
  value?: T;
  defaultValue?: T;
  options: readonly Option<T>[];
  onValueChange?: (value: T) => void;
  className?: string;
}) {
  return (
    <Select.Root
      name={name}
      items={options}
      value={value}
      defaultValue={defaultValue}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange?.(next as T);
      }}
    >
      <Select.Trigger className={`choice-select ${className}`} aria-label={label}>
        <Select.Value />
        <Select.Icon aria-hidden="true">⌄</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={6} className="choice-select-positioner">
          <Select.Popup className="choice-select-popup">
            <Select.List>
              {options.map((option) => (
                <Select.Item key={option.value} value={option.value} className="choice-select-item">
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator aria-hidden="true">✓</Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}

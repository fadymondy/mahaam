import { Search, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable } from "react-native";

import { Field, useColors } from "@/grid";
import { useT } from "@/i18n";

/** A search box on the grid's field; `onDebounced` fires 300ms after typing stops (as on the web). */
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const c = useColors();
  const t = useT();
  return (
    <Field
      value={value}
      onChangeText={onChange}
      placeholder={placeholder ?? t("common.search")}
      autoCapitalize="none"
      autoCorrect={false}
      returnKeyType="search"
      accessibilityLabel={placeholder ?? t("common.search")}
      icon={<Search size={17} color={c.muted} strokeWidth={1.6} />}
      trailing={
        value ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("common.clear")} hitSlop={12} onPress={() => onChange("")}>
            <X size={17} color={c.muted} strokeWidth={1.6} />
          </Pressable>
        ) : undefined
      }
    />
  );
}

/** The value, 300ms after it stops changing. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

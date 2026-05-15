/*
 * HaulerFilter — compact select for narrowing the trip analytics to a
 * single contributing hauler. Stays a <select> (not PillToggle) because
 * roster size is 5–10 and will grow as onboarding continues.
 */

import { SelectField } from '../primitives/FormField';

export default function HaulerFilter({ value, onChange, haulers }) {
  const options = [
    { value: '', label: 'All haulers' },
    ...(haulers?.map((h) => ({ value: h.id, label: h.display_name })) ?? []),
  ];

  return (
    <div style={{ minWidth: 220 }}>
      <SelectField
        label="Hauler filter"
        value={value ?? ''}
        onChange={onChange}
        options={options}
      />
    </div>
  );
}

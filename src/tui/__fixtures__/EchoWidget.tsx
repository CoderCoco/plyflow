import React, { useEffect } from 'react';
import { Text } from 'ink';

/**
 * Minimal widget fixture for testing.
 *
 * Widget contract: the App renders a widget component with:
 *   - `data: unknown`    — the props passed from the workflow step
 *   - `resolve: (value: unknown) => void` — call this to complete the widget UiRequest
 *
 * On mount this widget immediately resolves with its data, so tests can assert
 * the resolved value synchronously after a short async settle.
 */
export default function EchoWidget({
  data,
  resolve,
}: {
  data: unknown;
  resolve: (v: unknown) => void;
}): React.ReactElement {
  useEffect(() => {
    resolve(data);
  }, []);
  return <Text>widget:{String(data)}</Text>;
}

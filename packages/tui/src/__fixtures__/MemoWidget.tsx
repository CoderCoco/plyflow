import React from 'react';
import { Text } from 'ink';

/**
 * Fixture that exports a React.memo-wrapped component as its default export.
 * Used to verify that WidgetHost accepts wrapped (object) components, not just
 * bare functions.
 */
export default React.memo(function MemoWidget() {
  return <Text>memo-widget</Text>;
});

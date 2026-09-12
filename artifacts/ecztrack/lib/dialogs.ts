import { Alert, Platform } from "react-native";

/**
 * Cross-platform dialogs.
 *
 * react-native-web's Alert is a no-op (`static alert() {}`), so Alert.alert
 * silently does nothing in a browser. Anything user-facing has to branch on
 * Platform.OS and use the DOM equivalent on web.
 */

/** Shows a message. Resolves once the user has dismissed it. */
export function notify(title: string, message?: string): void {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

/**
 * Asks the user to confirm a destructive action.
 * Resolves true if confirmed, false otherwise.
 */
export function confirmDestructive(
  title: string,
  message: string,
  confirmLabel = "Delete",
): Promise<boolean> {
  if (Platform.OS === "web") {
    // eslint-disable-next-line no-alert
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
      ],
      // Android lets the user dismiss by tapping outside, which fires no
      // button handler; without this the promise would never settle.
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

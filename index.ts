import { AppRegistry } from 'react-native';
import { registerRootComponent } from 'expo';
import App from './App';
import { RNAndroidNotificationListenerHeadlessJsName } from 'react-native-android-notification-listener';
import { parseAndSaveTransaction } from './utils/transactionParser';

// Register the Headless JS task for background notification listener
const headlessNotificationListener = async ({ notification }: { notification: any }) => {
  if (notification) {
    try {
      let data;
      if (typeof notification === 'string') {
        data = JSON.parse(notification);
      } else {
        data = notification;
      }

      if (data) {
        // 1. If this is a grouped/bundled notification, parse the individual message list
        let parsed = false;
        if (data.groupedMessages && Array.isArray(data.groupedMessages)) {
          for (const msg of data.groupedMessages) {
            if (msg && msg.text) {
              const res = await parseAndSaveTransaction(msg.text, msg.title || data.title || data.app, data.time);
              if (res) parsed = true;
            }
          }
        }

        // 2. Try parsing fields sequentially, stopping at the first successful match
        if (!parsed) {
          const fieldsToTry = [
            { text: data.text, source: data.title },
            { text: data.bigText, source: data.title },
            { text: data.title, source: data.app },
            { text: data.titleBig, source: data.app },
            { text: data.summaryText, source: data.title }
          ];

          for (const field of fieldsToTry) {
            if (field.text && typeof field.text === 'string') {
              const res = await parseAndSaveTransaction(field.text, field.source || data.app, data.time);
              if (res) {
                break;
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('Headless notification listener error:', e);
    }
  }
};

AppRegistry.registerHeadlessTask(
  RNAndroidNotificationListenerHeadlessJsName,
  () => headlessNotificationListener
);

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
registerRootComponent(App);

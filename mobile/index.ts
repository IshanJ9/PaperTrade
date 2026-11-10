import { registerRootComponent } from 'expo';

import App from './App';
// Defines the iOS background task at module scope (TaskManager requires this before the app renders).
import './src/sync/backgroundTask';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

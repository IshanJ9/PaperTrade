import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/AppContext';
import { ActivityScreen } from './src/screens/ActivityScreen';
import { AuthScreen } from './src/screens/AuthScreen';
import { PortfolioScreen } from './src/screens/PortfolioScreen';
import { SymbolScreen } from './src/screens/SymbolScreen';
import { WatchlistScreen } from './src/screens/WatchlistScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function Tabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Watchlist" component={WatchlistScreen} />
      <Tab.Screen name="Portfolio" component={PortfolioScreen} />
      <Tab.Screen name="Activity" component={ActivityScreen} />
    </Tab.Navigator>
  );
}

function Root() {
  const { ready, signedIn } = useApp();
  if (!ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }
  if (!signedIn) return <AuthScreen />;
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="Symbol" component={SymbolScreen as any} options={({ route }) => ({ title: (route.params as any)?.symbol ?? 'Symbol' })} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Root />
        <StatusBar style="auto" />
      </AppProvider>
    </SafeAreaProvider>
  );
}

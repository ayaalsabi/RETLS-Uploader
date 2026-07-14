import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/LoginScreen';
import UploaderHomeScreen from '../screens/UploaderHomeScreen';
import ViewerInboxScreen from '../screens/ViewerInboxScreen';
import FileDetailScreen from '../screens/FileDetailScreenforUser';
import { RootStackParamList } from './types';
import FileDetailScreen1 from '../screens/FileDetalilsScreenforAdmin';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="UploaderHome" component={UploaderHomeScreen} />
        <Stack.Screen name="ViewerInbox" component={ViewerInboxScreen} />
        <Stack.Screen name="FileDetail" component={FileDetailScreen} />
        <Stack.Screen name="FileDetails" component={FileDetailScreen1} />

      </Stack.Navigator>
    </NavigationContainer>
  );
}

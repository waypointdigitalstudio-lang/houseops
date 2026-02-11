import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuthUser } from "../hooks/useAuthUser";

export default function NotFound() {
  const { user, loading } = useAuthUser();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  // If user is logged in, dump them into tabs.
  // If not, send to login.
  return <Redirect href={user ? "/(tabs)" : "/login"} />;
}

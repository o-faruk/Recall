import React from "react";
import { createRoot } from "react-dom/client";
import { withAuthenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";
import App from "./App.jsx";
import "./styles.css";
import { IS_MOCK } from "./api.js";
import "./auth.js";

// Demo mode (no backend) skips login. Live mode gates the app behind a
// Cognito login screen; sign-up is hidden (accounts are created in the console).
const Root = IS_MOCK ? App : withAuthenticator(App, { hideSignUp: true });

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);

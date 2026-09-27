import { supabase } from "./supabase.js";

const authForm = document.getElementById("authForm");

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const confirmPasswordInput = document.getElementById("confirmPassword");

const passwordField = document.getElementById("passwordField");
const confirmPasswordField = document.getElementById("confirmPasswordField");

const authTitle = document.getElementById("authTitle");
const authSubtitle = document.getElementById("authSubtitle");

const submitButton = document.getElementById("submitButton");
const forgotButton = document.getElementById("forgotButton");
const modeButton = document.getElementById("modeButton");

const message = document.getElementById("message");

let mode = "login";
let recoveryMode = false;


/* ------------------------------
   Helpers
------------------------------ */

function showMessage(text, type = "") {
  message.textContent = text;
  message.className = "message";

  if (type) {
    message.classList.add(type);
  }
}


function setLoading(loading) {
  submitButton.disabled = loading;

  if (loading) {
    submitButton.textContent = "Please wait...";
  } else {
    updateInterface();
  }
}


function getErrorMessage(error) {
  if (!error) {
    return "Something went wrong.";
  }

  const text = error.message || "";

  if (
    text.toLowerCase().includes("invalid login credentials")
  ) {
    return "The email or password is incorrect.";
  }

  if (
    text.toLowerCase().includes("email not confirmed")
  ) {
    return "Please confirm your email before signing in.";
  }

  if (
    text.toLowerCase().includes("user already registered")
  ) {
    return "An account with this email already exists.";
  }

  if (
    text.toLowerCase().includes("password should be at least")
  ) {
    return "Your password is too short.";
  }

  if (
    text.toLowerCase().includes("rate limit")
  ) {
    return "Too many attempts. Please wait a little and try again.";
  }

  return text;
}


/* ------------------------------
   Interface
------------------------------ */

function updateInterface() {
  if (recoveryMode) {
    authTitle.textContent = "Create a new password";

    authSubtitle.textContent =
      "Choose a new password for your Notely account.";

    passwordField.classList.remove("hidden");
    confirmPasswordField.classList.remove("hidden");

    forgotButton.classList.add("hidden");
    modeButton.classList.add("hidden");

    submitButton.textContent = "Update password";

    passwordInput.autocomplete = "new-password";

    return;
  }

  if (mode === "login") {
    authTitle.textContent = "Welcome back";

    authSubtitle.textContent =
      "Sign in to keep your notes synced across devices.";

    passwordField.classList.remove("hidden");
    confirmPasswordField.classList.add("hidden");

    forgotButton.classList.remove("hidden");

    modeButton.classList.remove("hidden");
    modeButton.textContent = "Create an account";

    submitButton.textContent = "Sign in";

    passwordInput.autocomplete = "current-password";

  } else {
    authTitle.textContent = "Create your account";

    authSubtitle.textContent =
      "Create an account to sync your notes securely.";

    passwordField.classList.remove("hidden");
    confirmPasswordField.classList.remove("hidden");

    forgotButton.classList.remove("hidden");

    modeButton.classList.remove("hidden");
    modeButton.textContent = "I already have an account";

    submitButton.textContent = "Create account";

    passwordInput.autocomplete = "new-password";
  }
}


/* ------------------------------
   Login
------------------------------ */

async function login() {
  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showMessage(
      "Enter your email and password.",
      "error"
    );

    return;
  }

  setLoading(true);
  showMessage("");

  const { error } =
    await supabase.auth.signInWithPassword({
      email,
      password
    });

  if (error) {
    showMessage(
      getErrorMessage(error),
      "error"
    );

    setLoading(false);
    return;
  }

  showMessage(
    "Signed in. Opening Notely...",
    "success"
  );

  window.location.href = "index.html";
}


/* ------------------------------
   Signup
------------------------------ */

async function signup() {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (!email || !password || !confirmPassword) {
    showMessage(
      "Complete all fields.",
      "error"
    );

    return;
  }

  if (password.length < 6) {
    showMessage(
      "Your password must be at least 6 characters.",
      "error"
    );

    return;
  }

  if (password !== confirmPassword) {
    showMessage(
      "The passwords don't match.",
      "error"
    );

    return;
  }

  setLoading(true);
  showMessage("");

  const redirectUrl =
    `${window.location.origin}${window.location.pathname
      .replace("auth.html", "index.html")}`;

  const { data, error } =
    await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl
      }
    });

  if (error) {
    showMessage(
      getErrorMessage(error),
      "error"
    );

    setLoading(false);
    return;
  }

  if (data.session) {
    showMessage(
      "Account created. Opening Notely...",
      "success"
    );

    window.location.href = "index.html";
    return;
  }

  showMessage(
    "Account created. Check your email to confirm your account.",
    "success"
  );

  setLoading(false);
}


/* ------------------------------
   Forgot password
------------------------------ */

async function resetPassword() {
  const email = emailInput.value.trim();

  if (!email) {
    showMessage(
      "Enter your email address first.",
      "error"
    );

    emailInput.focus();
    return;
  }

  forgotButton.disabled = true;

  showMessage(
    "Sending password reset email..."
  );

  const redirectUrl =
    `${window.location.origin}${window.location.pathname}`;

  const { error } =
    await supabase.auth.resetPasswordForEmail(
      email,
      {
        redirectTo: redirectUrl
      }
    );

  forgotButton.disabled = false;

  if (error) {
    showMessage(
      getErrorMessage(error),
      "error"
    );

    return;
  }

  showMessage(
    "Password reset email sent. Check your inbox.",
    "success"
  );
}


/* ------------------------------
   Update password
------------------------------ */

async function updatePassword() {
  const password = passwordInput.value;
  const confirmPassword = confirmPasswordInput.value;

  if (!password || !confirmPassword) {
    showMessage(
      "Enter and confirm your new password.",
      "error"
    );

    return;
  }

  if (password.length < 6) {
    showMessage(
      "Your password must be at least 6 characters.",
      "error"
    );

    return;
  }

  if (password !== confirmPassword) {
    showMessage(
      "The passwords don't match.",
      "error"
    );

    return;
  }

  setLoading(true);
  showMessage("");

  const { error } =
    await supabase.auth.updateUser({
      password
    });

  if (error) {
    showMessage(
      getErrorMessage(error),
      "error"
    );

    setLoading(false);
    return;
  }

  showMessage(
    "Password updated successfully. You can now sign in.",
    "success"
  );

  recoveryMode = false;
  mode = "login";

  passwordInput.value = "";
  confirmPasswordInput.value = "";

  setLoading(false);
}


/* ------------------------------
   Form submit
------------------------------ */

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (recoveryMode) {
    await updatePassword();
    return;
  }

  if (mode === "login") {
    await login();
  } else {
    await signup();
  }
});


/* ------------------------------
   Switch login / signup
------------------------------ */

modeButton.addEventListener("click", () => {
  mode = mode === "login"
    ? "signup"
    : "login";

  showMessage("");

  passwordInput.value = "";
  confirmPasswordInput.value = "";

  updateInterface();
});


/* ------------------------------
   Forgot password
------------------------------ */

forgotButton.addEventListener(
  "click",
  async () => {
    await resetPassword();
  }
);


/* ------------------------------
   Supabase auth events
------------------------------ */

supabase.auth.onAuthStateChange(
  async (event, session) => {

    if (
      event === "PASSWORD_RECOVERY"
    ) {
      recoveryMode = true;

      showMessage(
        "Choose a new password.",
        "success"
      );

      updateInterface();

      return;
    }

    if (
      session &&
      (
        event === "SIGNED_IN" ||
        event === "INITIAL_SESSION"
      )
    ) {
      if (!recoveryMode) {
        window.location.href = "index.html";
      }
    }
  }
);


/* ------------------------------
   Initial session check
------------------------------ */

async function initialize() {
  const {
    data: { session }
  } = await supabase.auth.getSession();

  if (session && !recoveryMode) {
    window.location.href = "index.html";
    return;
  }

  updateInterface();
}

initialize();

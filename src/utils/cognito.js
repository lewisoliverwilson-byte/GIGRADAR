import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from 'amazon-cognito-identity-js';
import { CONFIG } from './config.js';

const userPool = new CognitoUserPool({
  UserPoolId: CONFIG.cognitoUserPoolId,
  ClientId:   CONFIG.cognitoClientId,
});

function makeUser(email) {
  return new CognitoUser({ Username: email, Pool: userPool });
}

export function getCurrentUser() {
  return new Promise((resolve) => {
    const u = userPool.getCurrentUser();
    if (!u) return resolve(null);
    u.getSession((err, session) => {
      if (err || !session?.isValid()) return resolve(null);
      u.getUserAttributes((e2, attrs) => {
        if (e2) return resolve({ email: u.username, verified: true });
        const map = Object.fromEntries(attrs.map(a => [a.getName(), a.getValue()]));
        resolve({
          email:    map.email || u.username,
          name:     map.name || map.email || u.username,
          verified: map.email_verified === 'true',
          sub:      map.sub,
        });
      });
    });
  });
}

export function signUp(email, password, name) {
  return new Promise((resolve, reject) => {
    const attrs = [
      { Name: 'email', Value: email },
      { Name: 'name',  Value: name  },
    ].map(a => ({ getName: () => a.Name, getValue: () => a.Value }));

    // Use raw attribute objects — the SDK accepts plain objects too
    userPool.signUp(email, password, [
      { Name: 'email', Value: email },
      { Name: 'name',  Value: name  },
    ], null, (err, result) => {
      if (err) return reject(cognitoError(err));
      resolve(result.user);
    });
  });
}

export function confirmSignUp(email, code) {
  return new Promise((resolve, reject) => {
    makeUser(email).confirmRegistration(code, true, (err) => {
      if (err) return reject(cognitoError(err));
      resolve();
    });
  });
}

export function resendCode(email) {
  return new Promise((resolve, reject) => {
    makeUser(email).resendConfirmationCode((err) => {
      if (err) return reject(cognitoError(err));
      resolve();
    });
  });
}

export function signIn(email, password) {
  return new Promise((resolve, reject) => {
    const user    = makeUser(email);
    const details = new AuthenticationDetails({ Username: email, Password: password });
    user.authenticateUser(details, {
      onSuccess: () => resolve(user),
      onFailure: (err) => reject(cognitoError(err)),
      newPasswordRequired: () => reject(new Error('Password reset required.')),
    });
  });
}

export function signOut() {
  userPool.getCurrentUser()?.signOut();
}

export function forgotPassword(email) {
  return new Promise((resolve, reject) => {
    makeUser(email).forgotPassword({
      onSuccess: resolve,
      onFailure: (err) => reject(cognitoError(err)),
    });
  });
}

export function confirmForgotPassword(email, code, newPassword) {
  return new Promise((resolve, reject) => {
    makeUser(email).confirmPassword(code, newPassword, {
      onSuccess: resolve,
      onFailure: (err) => reject(cognitoError(err)),
    });
  });
}

function cognitoError(err) {
  const map = {
    UsernameExistsException:        'An account with this email already exists.',
    UserNotFoundException:           'No account found with this email.',
    NotAuthorizedException:         'Incorrect password.',
    CodeMismatchException:          'Incorrect verification code.',
    ExpiredCodeException:           'Code expired — request a new one.',
    UserNotConfirmedException:      'Please verify your email first.',
    InvalidPasswordException:       'Password must be at least 8 characters.',
    LimitExceededException:         'Too many attempts — please wait a moment.',
    InvalidParameterException:      'Please check your details and try again.',
  };
  return new Error(map[err.code] || err.message || 'Something went wrong.');
}

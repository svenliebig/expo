import { gql } from '@urql/core';
import { promises as fs } from 'fs';

import { getAccessToken, getSession, setSessionAsync } from './UserSettings';
import { getSessionUsingBrowserAuthFlowAsync } from './expoSsoLauncher';
import { CurrentUserQuery } from '../../graphql/generated';
import * as Log from '../../log';
import { getDevelopmentCodeSigningDirectory } from '../../utils/codesigning';
import { env } from '../../utils/env';
import { getExpoWebsiteBaseUrl } from '../endpoint';
import { graphqlClient } from '../graphql/client';
import { UserQuery } from '../graphql/queries/UserQuery';
import { fetchAsync } from '../rest/client';

export type Actor = NonNullable<CurrentUserQuery['meActor']>;

let currentUser: Actor | undefined;

export const ANONYMOUS_USERNAME = 'anonymous';

/**
 * Resolve the name of the actor, either normal user or robot user.
 * This should be used whenever the "current user" needs to be displayed.
 * The display name CANNOT be used as project owner.
 */
export function getActorDisplayName(user?: Actor): string {
  switch (user?.__typename) {
    case 'User':
      return user.username;
    case 'SSOUser':
      return user.username;
    case 'Robot':
      return user.firstName ? `${user.firstName} (robot)` : 'robot';
    default:
      return ANONYMOUS_USERNAME;
  }
}

export async function getUserAsync(): Promise<Actor | undefined> {
  const hasCredentials = getAccessToken() || getSession()?.sessionSecret;
  if (!env.EXPO_OFFLINE && !currentUser && hasCredentials) {
    const user = await UserQuery.currentUserAsync();
    currentUser = user ?? undefined;
  }
  return currentUser;
}

export async function loginAsync(credentials: {
  username: string;
  password: string;
  otp?: string;
}): Promise<void> {
  const res = await fetchAsync('auth/loginAsync', {
    method: 'POST',
    body: JSON.stringify(credentials),
  });
  const json: any = await res.json();
  const sessionSecret = json.data.sessionSecret;

  const userData = await fetchUserAsync({ sessionSecret });

  await setSessionAsync({
    sessionSecret,
    userId: userData.id,
    username: userData.username,
    currentConnection: 'Username-Password-Authentication',
  });
}

export async function ssoLoginAsync(): Promise<void> {
  const sessionSecret = await getSessionUsingBrowserAuthFlowAsync({
    expoWebsiteUrl: getExpoWebsiteBaseUrl(),
  });
  const userData = await fetchUserAsync({ sessionSecret });

  await setSessionAsync({
    sessionSecret,
    userId: userData.id,
    username: userData.username,
    currentConnection: 'Browser-Flow-Authentication',
  });
}

export async function logoutAsync(): Promise<void> {
  currentUser = undefined;
  await Promise.all([
    fs.rm(getDevelopmentCodeSigningDirectory(), { recursive: true, force: true }),
    setSessionAsync(undefined),
  ]);
  Log.log('Logged out');
}

async function fetchUserAsync({
  sessionSecret,
}: {
  sessionSecret: string;
}): Promise<{ id: string; username: string }> {
  const result = await graphqlClient
    .query(
      gql`
        query UserQuery {
          meUserActor {
            id
            username
          }
        }
      `,
      {},
      {
        fetchOptions: {
          headers: {
            'expo-session': sessionSecret,
          },
        },
        additionalTypenames: [] /* UserQuery has immutable fields */,
      }
    )
    .toPromise();
  const { data } = result;
  return {
    id: data.meUserActor.id,
    username: data.meUserActor.username,
  };
}

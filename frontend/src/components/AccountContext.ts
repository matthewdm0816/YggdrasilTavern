import { createContext, useContext } from "react";
import type { AuthStatus } from "../lib/api";

export const AccountContext = createContext<{
  status: AuthStatus;
  updateStatus: (status: AuthStatus) => void;
  logout: () => Promise<void>;
  statusError?: string | null;
} | null>(null);

export function useAccount() { return useContext(AccountContext); }

import { atom } from 'nanostores';
import type { TabType } from '~/components/@settings/core/types';

type SettingsPanelRequest = {
  open: boolean;
  tab: TabType | null;
};

export const settingsPanelRequestStore = atom<SettingsPanelRequest>({
  open: false,
  tab: null,
});

export function requestOpenSettings(tab?: TabType) {
  settingsPanelRequestStore.set({
    open: true,
    tab: tab ?? null,
  });
}

export function clearSettingsPanelRequest() {
  settingsPanelRequestStore.set({
    open: false,
    tab: null,
  });
}

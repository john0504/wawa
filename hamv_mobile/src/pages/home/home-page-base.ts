import {
  NavController,
  Platform,
  AlertOptions,
  AlertController,
} from 'ionic-angular';
import { Storage } from '@ionic/storage';
import {
  Group,
  StateStore,
  AppTasks
} from 'app-engine';
import { TranslateService } from '@ngx-translate/core';
import {
  Observable,
  Subscription,
} from 'rxjs';
import { combineLatest } from 'rxjs/observable/combineLatest';
import {
  pairwise,
  tap,
} from 'rxjs/operators';
import isEqual from 'lodash/isEqual';

import { debounceImmediate } from '../../app/app.extends';
import { ThemeService } from '../../providers/theme-service';

import { ScrollableTabsOptions } from '../../components/scrollable-tabs/scrollable-tabs-options';
import { MqttService } from '../../providers/mqtt-service';
import { NativeAudio } from '@ionic-native/native-audio';
import { PopupService } from '../../providers/popup-service';
import { Vibration } from '@ionic-native/vibration';

const TAB_CONFIG = 'tabConfig';
const USER_SETTING = 'userSetting';

export abstract class HomePageBase {

  protected groupComponent;
  protected deviceComponent;

  private account$: Observable<any>;
  private deviceDisplayList$: Observable<any>;
  private groupDisplayList$: Observable<any>;
  private groups$: Observable<any>;
  private subs: Array<Subscription>;
  private userData$: Observable<any>;

  isLoggedIn: boolean = false;
  selectedGroup;
  groupsList: Array<any> = [];
  ready: boolean = false;
  tabs: Array<ScrollableTabsOptions> = [];
  currentTab: number = 0;
  myDevicesGroup: Group;
  public _deviceList = [];
  updateOnline;
  userSetting = { isGiftSound: true, isGiftVibration: true };

  constructor(
    private navCtrl: NavController,
    private platform: Platform,
    private stateStore: StateStore,
    private translate: TranslateService,
    private storage: Storage,
    public themeService: ThemeService,
    public appTasks: AppTasks,
    public alertCtrl: AlertController,
    public mqttService: MqttService,
    public nativeAudio: NativeAudio,
    public popupService: PopupService,
    public vibration: Vibration
  ) {
    this.subs = [];
    this.account$ = this.stateStore.account$;
    this.deviceDisplayList$ = this.stateStore.deviceDisplayList$;
    this.groupDisplayList$ = this.stateStore.groupDisplayList$;
    this.groups$ = this.stateStore.groups$;
    this.userData$ = this.stateStore.userData$;

    this.storage.get(TAB_CONFIG)
      .then(value => {
        const isValid = value && value.lastSelectedIndex >= 0;
        this.currentTab = isValid ? value.lastSelectedIndex : 0;
      });
  }

  ionViewDidEnter() {
    this.nativeAudio.preloadSimple('gift', 'assets/audio/gift.mp3');
    this.subs.push(
      this.account$
        .pipe(
          tap(account => this.isLoggedIn = account && account.isLoggedIn),
          pairwise()
        )
        .subscribe(([oldAccount, newAccount]) => {
          const oldLoginState = oldAccount && oldAccount.isLoggedIn;
          const newLoginState = newAccount && newAccount.isLoggedIn;
          if (!oldLoginState && newLoginState) this.ready = false;
        })
    );
    this.subs.push(
      combineLatest(this.deviceDisplayList$, this.groups$, this.groupDisplayList$, this.userData$, this.translate.stream(['HOME']))
        .pipe(
          debounceImmediate(500),
          tap(() => {
            if (!this.ready) this.ready = true;
          })
        )
        .subscribe(latestValues => this.processValues(latestValues))
    );
    this.loadDeviceList();
    setTimeout(() => {
      this.loadDeviceList();
    }, 1000);
    this.updateOnline = setInterval(() => {
      this.loadDeviceList();
    }, 3000);
  }

  ionViewWillLeave() {
    this.subs && this.subs.forEach((s) => {
      s.unsubscribe();
    });
    this.subs.length = 0;
    clearInterval(this.updateOnline);
    this.updateOnline = null;
    this._deviceList = [];
  }

  loadDeviceList() {
    if (this.mqttService.canLogout()) {
      this.logoutAlert();
      return;
    }
    var isChange = this.mqttService.isListChange();
    var newlist = this.mqttService.getDeviceList();

    var offlineTime = Date.now() / 1000 - 60 * 2;
    var updateTime = Date.now() / 1000 - 30;
    var onlineList = [];
    var offlineList = [];
    newlist.forEach(device => {
      var online = device.UpdateDate > offlineTime;
      var update = device.UpdateTimestamp > updateTime;
      var updateMoney = device.UpdateMoneyTime > updateTime;
      var updateGift = device.UpdateGiftTime > updateTime;
      device.UpdateTime = this.mqttService.getTime(device.UpdateTimestamp);
      if (device.Online != online) {
        device.Online = online;
        isChange = true;
      }
      if (update && !device.updateMoney) {
        device.updateMoney = device.money != (device.H68 << 16) + device.H69;
        if (device.updateMoney) {
          isChange = true;
          // device.UpdateTime = this.mqttService.getTime(Date.now() / 1000);
        }
      } else if (!update) {
        device.updateMoney = false;
        device.isMoneyChange = false;
      }

      if (update && device.money != (device.H68 << 16) + device.H69) {
        device.UpdateMoneyTime = Date.now() / 1000;
        device.isMoneyChange = true;
      } else if (!updateMoney) {
        device.isMoneyChange = false;
      }

      if (update && !device.updateGift) {
        device.updateGift = device.gift != (device.H6A << 16) + device.H6B;
        if (device.updateGift) {
          isChange = true;
          // device.UpdateTime = this.mqttService.getTime(Date.now() / 1000);
        }
      } else if (!update) {
        device.updateGift = false;
        device.isGiftChange = false;
      }

      if (update && device.gift != (device.H6A << 16) + device.H6B) {
        device.UpdateGiftTime = Date.now() / 1000;
        this.giftAlert(device);
        device.isMoneyChange = false;
        device.isGiftChange = true;
      } else if (!updateGift) {
        device.isGiftChange = false;
      }

      if (device.Update != update) {
        isChange = true;
        device.Update = device.updateMoney | device.updateGift;
      }
      if (device.Online) {
        onlineList.push(device);
      } else {
        offlineList.push(device);
      }
      device.money = (device.H68 << 16) + device.H69;
      device.gift = (device.H6A << 16) + device.H6B;
    });
    offlineList.forEach(device => {
      onlineList.push(device);
    });
    if (isChange || this._deviceList.length == 0) {
      if (this._deviceList.length == 0) {
        onlineList.forEach(device => {
          device.updateMoney = false;
          device.updateGift = false;
          device.isMoneyChange = false;
          device.isGiftChange = false;
        });
      }
      this._deviceList = onlineList;
    }
  }

  logoutAlert() {
    const alertTitle = "已與伺服器斷開，請重新登入";
    let options: AlertOptions = {
      title: alertTitle,
      buttons: [
        {
          text: "確定",
          handler: () => {
            this.logout();
          },
        }
      ],
    };

    const alert = this.alertCtrl.create(options);
    alert.present();
  }

  private giftAlert(device) {
    this.storage.get(USER_SETTING)
      .then(userSetting => {
        this.userSetting = userSetting ? userSetting : { isGiftSound: true, isGiftVibration: true };
        if (this.userSetting.isGiftSound) {
          this.nativeAudio.play('gift');
        }
        if (this.userSetting.isGiftVibration) {
          this.vibration.vibrate(1000);
        }
        const giftToastMsg = `出貨通知:${device.DevName}`;
        this.popupService.makeToast({
          message: giftToastMsg,
          duration: 10000,
          position: 'top',
          showCloseButton: true,
          closeButtonText: 'X',
        });
      });
  }

  private createTabsFromGroups(groups) {
    const tabs = groups.map((group) => {
      let title = this.translate.instant('HOME.LOADING'); // placeholder
      if (group && group.properties && group.properties.displayName) {
        title = group.properties.displayName;
      }
      return ({ title });
    });

    return tabs;
  }

  private processValues(latestValues) {
    const [
      deviceDisplayList,
      groups,
      groupDisplayList,
      userData,
    ] = latestValues;
    const groupsList = [];
    const { groupDisplayOrder } = userData;
    const groupOrder = groupDisplayOrder ? groupDisplayOrder : groupDisplayList;

    this.myDevicesGroup = this.generateGroup(deviceDisplayList, groups, groupOrder);
    this.myDevicesGroup.properties['displayName'] = this.translate.instant('MY_DEVICES.ALL_DEVICES');

    for (const groupId of groupOrder) {
      groupsList.push(groups[groupId]);
    }

    this.groupsList = groupsList;
    const tabs = this.createTabsFromGroups(groupsList);
    tabs.unshift({
      title: this.translate.instant('HOME.ALL'),
    });
    if (!isEqual(this.tabs, tabs)) {
      this.tabs = tabs;
    }
    if (this.currentTab > this.groupsList.length) {
      this.currentTab = 0;
    }
    this.selectGroup(this.currentTab);
  }

  isIOS(): boolean {
    return this.platform.is('ios');
  }

  goGroupDetail({ name }) {
    this.navCtrl.push('GroupDetailPage', { groupId: name });
  }

  tabSelected(tab) {
    const tabIndex = tab.index;
    const tabConfig = {
      lastSelectedIndex: tab.index,
    };
    this.currentTab = tab.index;
    this.storage.set(TAB_CONFIG, tabConfig);
    this.selectGroup(tabIndex);
  }

  private generateGroup(deviceDisplayList, groups, groupDisplayList = []): Group {
    let myDevices = [];

    groupDisplayList
      .forEach(groupId => {
        const g = groups[groupId];
        if (g && g.devices) myDevices = myDevices.concat(g.devices);
      });

    deviceDisplayList.forEach((deviceSn) => {
      const found = groupDisplayList.some((groupId) => {
        const group = groups[groupId];
        return group && group.devices && group.devices.some(dSn => (dSn === deviceSn));
      });

      if (!found) {
        myDevices.push(deviceSn);
      }
    });

    return {
      name: '__my_devices_group__',
      devices: myDevices,
      properties: {
      },
    };
  }

  private selectGroup(tabIndex) {
    if (tabIndex > 0) {
      this.selectedGroup = this.groupsList[tabIndex - 1];
    } else {
      this.selectedGroup = null;
    }
  }

  logout() {
    this.appTasks.logoutTask()
      .then(() => {
        this.goHomePage();
      });
  }

  private goHomePage() {
    this.navCtrl.setRoot('HomePage');
  }
}

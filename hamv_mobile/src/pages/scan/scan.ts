import { Component } from '@angular/core';
import {
  IonicPage, NavController,
  NavParams,
  //  ViewController 
} from 'ionic-angular';
import { ZBar, ZBarOptions } from '@ionic-native/zbar';

/**
 * Generated class for the ScanPage page.
 *
 * See https://ionicframework.com/docs/components/#navigation for more info on
 * Ionic pages and navigation.
 */
@IonicPage()
@Component({
  selector: 'page-scan',
  templateUrl: 'scan.html',
})
export class ScanPage {
  isShow: boolean = false;
  callback;

  constructor(
    private navCtrl: NavController,
    private navParams: NavParams,
    private zbar: ZBar,
  ) {
    this.callback = this.navParams.get('callback');
  }

  ionViewDidLoad() {
    let options: ZBarOptions = {
      flash: 'off',
      drawSight: false
    };
    this.zbar.scan(options)
      .then(machineType => {
        this.callback(machineType);
        this.navCtrl.pop();
      })
      .catch(error => {
        console.log(error); // Error message
      });
  }

  ionViewDidEnter() {
    this.isShow = true;
 
  }

  ionViewWillLeave() {
  }

  showCamera() {
    (window.document.querySelector('ion-app') as HTMLElement).classList.add('cameraView');
  }
}
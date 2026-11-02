import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "../src/styles/global.css";

createApp(App).use(createPinia()).mount("#root");

import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./styles/global.css";

createApp(App).use(createPinia()).mount("#root");

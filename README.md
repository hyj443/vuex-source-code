# 深入浅出Vuex源码

## Vuex中的store如何注入到组件中

在使用Vuex前，先安装Vuex
```js
import Vuex from 'vuex';
Vue.use(vuex);
```
在new Vue() 之前调用全局方法 Vue.use(Vuex)，实际会调用Vuex.install(Vue)
我们来看看Vue.use()在Vue中的实现:
```js
  initUse(Vue);
  function initUse (Vue) {
    Vue.use = function (plugin) {
      var installedPlugins = (this._installedPlugins || (this._installedPlugins = []));
      if (installedPlugins.indexOf(plugin) > -1) { // 注册过此插件
        return this // this指向Vue，因为Vue.use(plugin)
      }
      var args = toArray(arguments, 1); // 类数组转成数组，1代表从索引1开始，也就是use可以传别的
      args.unshift(this);
      if (typeof plugin.install === 'function') { // 如果plugin是对象且有install这个方法
        plugin.install.apply(plugin, args); // 调用install方法，把args参数传入，args第一个是Vue
      } else if (typeof plugin === 'function') {
        plugin.apply(null, args);
      }
      installedPlugins.push(plugin); // 注册过的plugin推入数组
      return this
    };
  }

```
所以我们得知，Vue.use(plugin)的时候，会调用插件的install方法，并传入Vue
我们来看看Vuex中的install的实现，src\store.js文件中
```js
export function install(_Vue) {
  if (Vue && _Vue === Vue) { // 避免重复安装，Vue.use内部也会检测一次是否重复安装
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue // 保存传入的Vue
  applyMixin(Vue) // 在Vue的生命周期中初始化
}
```
所以install代码做了两件事：1.防止Vuex被重复安装，2.执行applyMixin，在Vue的生命周期中初始化Vuex
现在我们来看看applyMixin是怎么实现的，src\mixin.js中：
```js
export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])
  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit }) // beforeCreate在实例初始化之后，数据观测和事件配置之前调用
  } else {/**/}
  // Vuex初始化钩子，会注入到每个实例的钩子列表
  function vuexInit () {
    const options = this.$options
    // 给vue实例注入一个$store属性，这就是为什么能在组件中this.$store访问到Vuex的各种状态
    if (options.store) { // 如果存在store，就代表当前组件是根组件(Root节点)
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) {
      // 如果当前的this.$options没有store，就取父组件的$store，保证了所有组件都共用一份全局store
      this.$store = options.parent.$store
    }
  }
}

```
所有Vue组件都可以通过this.$store访问全局的Store实例

## 探究 Store 类
我们使用Vuex时，通常会实例化Store，提过一个初始state对象和一些mutation
```js
const store=new Vuex.Store({
  state: {
    count: 0
  },
  mutations: {
    add (state) {
      state.count++
    }
  }
  // getters..actions...
})
```
Vuex还允许我们将store切分为module，每个module有自己的state mutation...甚至嵌套子module
```js
const moduleA = {
  state: { ... },
  mutations: { ... },
  actions: { ... },
  getters: { ... }
}
const moduleB = {
  state: { ... },
  mutations: { ... },
  actions: { ... }
}
const store = new Vuex.Store({
  modules: {
    a: moduleA,
    b: moduleB
  }
})
store.state.a // -> moduleA 的状态
store.state.b // -> moduleB 的状态
```
所以使用了module后，state就被模块化，比如要调用根模块的state，则`store.state.xxx`，如果要调用a模块的state，则调用`store.state.a.xxx`我们看看Store的实现，先看constructor方法
```js
let Vue
constructor(options = {}) {
  
  // 浏览器环境下如果没有安装过就自动install
  if (!Vue && typeof window !== 'undefined' && window.Vue) {
    install(window.Vue)
  }

  if (process.env.NODE_ENV !== 'production') {
    assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
    // 确保Vue存在，也就是实例化store前install过
    assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
    // 确保Promise可用，Vuex源码依赖promise的
    assert(this instanceof Store, `store must be called with the new operator.`)
    // Store类必须用new调用
  }

  const { plugins = [], strict = false} = options // 解构赋值

  // store internal state
  this._committing = false // 标志一个提交状态，保证对state的修改只能在mutation的回调函数中修改，不能在外部修改state
  this._actions = Object.create(null) // 存放actions
  this._actionSubscribers = []
  this._mutations = Object.create(null) // 存放mutations
  this._wrappedGetters = Object.create(null) // 存放getters
  this._modules = new ModuleCollection(options) // module收集器
  this._modulesNamespaceMap = Object.create(null) // 根据namespace存放module
  this._subscribers = [] // 存储所有对mutation变化的订阅者
  this._watcherVM = new Vue() // vue实例，主要用它的实例方法$watch来观测变化

  // bind commit and dispatch to self
  const store = this // store取到当前Store实例
  const { dispatch, commit } = this // dispatch、commit取到Store原型上的同名方法
  this.dispatch = function boundDispatch(type, payload) {
    // dispatch和commit挂载到store实例上，
    // 执行时的this改成指向store，否则在组件里调用this.dispatch，this指向当前vm实例
    return dispatch.call(store, type, payload)
  }
  this.commit = function boundCommit(type, payload, options) {
    return commit.call(store, type, payload, options)
  }

  // strict mode 严格模式下会观测所有state变化，建议开发的时候打开，线上环境关闭，节省性能开销
  this.strict = strict

  const state = this._modules.root.state

  // 初始化根module，同时递归注册所有的子module
  // 收集所有module的getters到this._wrappedGetters 中去
  // this._modules.root：根module才独有保存的Module对象
  installModule(this, state, [], this._modules.root)

  // 通过vm重设store，新建Vue实例 将所有getters注册为计算属性
  resetStoreVM(this, state)

  // apply plugins
  plugins.forEach(plugin => plugin(this))

  // 上面这三句是Vuex初始化的核心，installModule方法是把options传入的各种属性模块注册和安装
  // resetStoreVM方法是初始化 store._vm，观测state和getters的变化
  // 最后是应用传入的插件

  const useDevtools = options.devtools !== undefined ? options.devtools : Vue.config.devtools
  if (useDevtools) {
    devtoolPlugin(this)
  }
}

```
Store函数除了初始化一些内部变量之外，主要执行了installModule，和resetStoreVM，分别初始化module和通过vm使store响应式
但你在跟模块注册的mutation和在子模块注册的mutation，如果同名的话，调用store.commit('xxx')，将会调用根模块和子模块的该mutation，除非区分命名
vuex2后的版本添加了命名空间的功能，使得module更加模块化，只有state是被模块化了，action mutation getter都还是在全局的模块下
### installModule

```js
function installModule(store, rootState, path, module, hot) {

  const isRoot = !path.length // 是否为根module
  const namespace = store._modules.getNamespace(path) // 获取module的namespace

  // register in namespace map
  if (module.namespaced) {
    if (store._modulesNamespaceMap[namespace] && process.env.NODE_ENV !== 'production') {
      console.error(`[vuex] duplicate namespace ${namespace} for the namespaced module ${path.join('/')}`)
    }
    store._modulesNamespaceMap[namespace] = module
  }

  // set state
  if (!isRoot && !hot) { // 不为根且非热更新
    const parentState = getNestedState(rootState, path.slice(0, -1)) // 获取父级的state
    const moduleName = path[path.length - 1] // module的name
    store._withCommit(() => { // 将子module设置成响应式的
      Vue.set(parentState, moduleName, module.state)
    })
  }

  const local = module.context = makeLocalContext(store, namespace, path)

  module.forEachMutation((mutation, key) => { // 遍历注册mutation
    const namespacedType = namespace + key
    registerMutation(store, namespacedType, mutation, local)
  })

  module.forEachAction((action, key) => { // 遍历注册action
    const type = action.root ? key : namespace + key
    const handler = action.handler || action
    registerAction(store, type, handler, local)
  })

  module.forEachGetter((getter, key) => { // 遍历注册getter
    const namespacedType = namespace + key
    registerGetter(store, namespacedType, getter, local)
  })

  module.forEachChild((child, key) => { // 递归安装module
    installModule(store, rootState, path.concat(key), child, hot)
  })
}
```
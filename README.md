# 深入浅出Vuex源码

## 回顾一下Vuex是什么

Vuex 是一个专为Vue框架设计的，进行状态管理的库，将共享的数据抽离，放到全局形成一个单一的store，同时利用了Vue内部的响应式机制来进行状态的管理和更新，它是与Vue设计高度契合的库。

下图是Vue的单向数据流的特点图：
![单向数据流](https://vuex.vuejs.org/flow.png)

Vuex，在全局有一个state存放数据，，所有修改state的操作必须通过mutation进行，mutation的同时，提供了订阅者模式供外部插件调用获取state数据的更新。
所有异步操作都走action，比如调用后端接口异步获取数据，但在action中不能直接修改state，还是要通过若干个mutation来修改state，所以Vuex中数据流是单向的。
state的变化是响应式的，因为Vuex依赖Vue的数据双向绑定，需要new一个Vue对象来实现响应式化

![vuex组成](https://vuex.vuejs.org/vuex.png)

## Vuex中的store如何注入到组件中

在使用Vuex前，先安装Vuex，必须在 `new Vue()` 之前调用全局方法 `Vue.use(Vuex)`

```js
import Vuex from 'vuex';
Vue.use(vuex);
```

`import Vuex from 'vuex'`时，拿到的是下面这个对象，定义在src\index.js中

```js
export default {
  Store,
  install,
  version: '__VERSION__',
  mapState,
  mapMutations,
  mapGetters,
  mapActions,
  createNamespacedHelpers
}
```

从 Vue 源码可知，调用全局方法 `Vue.use(Vuex)` ，实际会调用 `Vuex.install(Vue)`

我们不妨看看 Vue 源码的 `Vue.use` 部分，是如何实现的：

```js
initUse(Vue);
function initUse (Vue) { // this指向Vue，因为Vue.use(plugin)
  Vue.use = function (plugin) {
    var installedPlugins = (this._installedPlugins || (this._installedPlugins = []));
    if (installedPlugins.indexOf(plugin) > -1) { // 注册过此插件
      return this
    }
    var args = toArray(arguments, 1); // 从索引1开始，参数类数组转成数组
    args.unshift(this);
    if (typeof plugin.install === 'function') { // 如果plugin是对象且有install方法
      plugin.install.apply(plugin, args); // 调用install，把Vue对象作为第一个参数传入
    } else if (typeof plugin === 'function') {
      plugin.apply(null, args);
    }
    installedPlugins.push(plugin); // 注册过的plugin推入数组
    return this
  };
}
```
所以可知，`Vue.use(plugin)` 时，会调用插件的`install`方法，并至少传入`Vue`
我们来看看`Vuex`中的`install`的实现，src\store.js文件中
```js
let Vue
// ....
export function install(_Vue) {
  if (Vue && _Vue === Vue) { // 避免重复安装。Vue.use内部也会检测一次
    if (process.env.NODE_ENV !== 'production') {
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      )
    }
    return
  }
  Vue = _Vue // 保存传入的Vue
  applyMixin(Vue)
}
```
所以install代码做了两件事：

1. 防止Vuex被重复安装

2. 执行applyMixin，并传入Vue对象

那问题来了，applyMixin做了什么呢？我们看看源码中的具体实现：

```js
export default function (Vue) {
  const version = Number(Vue.version.split('.')[0])
  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit })
    // beforeCreate 的调用是在实例初始化之后，数据观测和事件配置之前
    // Vue.mixin全局注册一个混入，影响注册之后所有创建的每个 Vue 实例。
  } else {/**/}
  // options.store 就是在根组件注册的store选项
  function vuexInit () {
    const options = this.$options
    if (options.store) { // 如果存在store，就代表当前组件是根组件
      this.$store = typeof options.store === 'function'
        ? options.store()
        : options.store
    } else if (options.parent && options.parent.$store) {
      // 如果this.$options没有store(意味着是子组件)，就取父组件的$store
      this.$store = options.parent.$store
    }
  }
}
```

applyMixin做的是全局注册混入一个beforeCreate钩子函数，之后创建的每个 Vue 实例的生命周期中都会执行vuexInit函数。

vuexInit中干的事：将 `new Vue()` 时传入的 `store` 保存到 `this` 对象的 `$store` 属性上，子组件则从其父组件上引用其 `$store` 属性，进行层层嵌套设置，保证每一个组件中都可以通过 `this.$store` 取到 `store` 对象。

通过在根实例中注册 store 选项，该 store 实例会注入到根组件下的所有子组件中，注入方法是子组件从父组件拿，这样所有子组件都可以取到store对象。

下面我们来看看 `new Vuex.Store()` 干了什么

## 探究 Store 类

我们使用Vuex时，通常会实例化Store，Store的构造函数接收一个对象，包含actions 、 getters 、 state 、 mutations 、 modules等，返回出store实例，并传入new Vue的options中，也就是刚才提到的 options.store

```js
const store=new Vuex.Store({
  state,
  mutations,
  actions,
  getters,
  modules
})
```

我们先看看 `Store` 类的 `constructor` 方法，在src\store.js中

首先，在 constructor 中进行了 Vue 的判断，如果没有调用过 Vue.use(Vuex) 安装 Vuex，则调用 install 自动安装。

并在非生产环境进行判断：必须安装过Vuex (Vue存在)，必须支持 Promise，必须用 new 创建 store。

```js
if (!Vue && typeof window !== 'undefined' && window.Vue) {
  install(window.Vue) // 浏览器环境下如果没有安装过就自动install
}
if (process.env.NODE_ENV !== 'production') {
  assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
  // 确保Vue存在，也就是实例化store前install过
  assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
  // 确保Promise可用，Vuex源码依赖promise
  assert(this instanceof Store, `store must be called with the new operator.`)
  // Store类必须用new调用
}
```
然后进行一系列的初始化，初始化一些内部属性。其中重点是`new ModuleCollection(options)`，初始化module

```js
  const { plugins = [], strict = false} = options // 解构赋值
  // store实例的内部状态
  this._committing = false // 提交mutation状态的标志
  this._actions = Object.create(null) // 存放actions
  this._actionSubscribers = [] // action 订阅函数集合
  this._mutations = Object.create(null) // 存放mutations
  this._wrappedGetters = Object.create(null) // 存放getters
  this._modules = new ModuleCollection(options) // module收集器
  this._modulesNamespaceMap = Object.create(null) // 根据namespace存放module，模块命名空间
  this._subscribers = [] // 存储所有对mutation变化的订阅者
  this._watcherVM = new Vue() // vue实例，用它的$watch来观测变化

// Vuex支持store分模块传入，在内部用Module构造函数将传入的options构造成一个Module对象，
// 如果没有命名模块，默认绑定在this._modules.root上
// ModuleCollection 内部调用 new Module构造函数
```

属性初始化完毕后，从this中（store实例）解构出Store的原型上的dispatch、commit方法，进行二次包装（将执行时的this指向当前store实例，否则在组件里调用this.xxx时this指向当前vm实例）后，作为属性方法挂载到this上（store实例）

简言之，就是把Store类的原型上的两个方法挂载到当前store实例上，并把this也指向这个store实例。
这样我们在组件中通过 this.$store 直接调用这两方法时，方法中的this不会指向当前组件的vm实例

```js
  const store = this // store取到当前Store实例
  const { dispatch, commit } = this // dispatch、commit 取到Store原型上的同名方法
  this.dispatch = function boundDispatch(type, payload) { // 挂载到store实例
    // 执行时的this改成指向store，否则在组件里调用this.dispatch，this指向当前vm实例
    return dispatch.call(store, type, payload)
  }
  this.commit = function boundCommit(type, payload, options) {
    return commit.call(store, type, payload, options)
  }
```

接着，包括严格模式的设置、根state的赋值、模块的注册、state的响应式、插件的注册等等，其中的重点在 installModule 函数中，在这里实现了所有modules的注册。

```js
  // options中传入的，是否启用严格模式
  this.strict = strict
  // new ModuleCollection 构造出来的_mudules
  const state = this._modules.root.state

  // 初始化根module，同时递归注册所有的子module
  // 收集所有module的 getters 存储到 this._wrappedGetters
  // this._modules.root：根module才独有保存的Module对象
  installModule(this, state, [], this._modules.root)

  // 通过Vue实例，初始化 store.vm，使state变成响应式的，并将getters变成计算属性
  resetStoreVM(this, state)

  // 注册 Vuex 插件
  plugins.forEach(plugin => plugin(this))

// 调试工具注册
  const useDevtools = options.devtools !== undefined ? options.devtools : Vue.config.devtools
  if (useDevtools) {
    devtoolPlugin(this)
  }
```

到目前为止，constructor 中所有的代码已经分析完毕。
Store函数主要做了三件事：

1. 初始化一些内部变量，特别是初始化module
2. 执行installModule，安装了模块
3. 执行了resetStoreVM，初始化 store.vm，通过vm使store响应式
  
其中重点是 new ModuleCollection(options) 和 installModule ，那么接下来我们到它们的内部去看看，究竟都干了些什么。
为什么要划分模块？
由于Vuex使用单一状态树，所有的状态会集中到一个比较大的对象，当应用变得很复杂的时候，store对象就有可能变得相当臃肿
因此 Vuex 允许我们将store切分为module，每个module有自己的state mutation...甚至嵌套子module
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

从数据结构来看，模块的设计就是一个树形结构，store本身可以理解为一个root module，下面的module是子模块
Vuex构建这个树的入口就是
```js
this._modules = new ModuleCollection(options) // module收集器
```
我们看看`ModuleCollection`这个构造函数，在`src\module\module-collection.js`中
```js
export default class ModuleCollection {
  constructor (rawRootModule) {
    // register root module (Vuex.Store options)
    this.register([], rawRootModule, false)
  }

  get (path) {
    return path.reduce((module, key) => {
      return module.getChild(key)
    }, this.root)
  }

  getNamespace (path) {
    let module = this.root
    return path.reduce((namespace, key) => {
      module = module.getChild(key)
      return namespace + (module.namespaced ? key + '/' : '')
    }, '')
  }

  update (rawRootModule) {
    update([], this.root, rawRootModule)
  }

  register (path, rawModule, runtime = true) {
    if (process.env.NODE_ENV !== 'production') {
      assertRawModule(path, rawModule)
    }

    const newModule = new Module(rawModule, runtime)
    if (path.length === 0) {
      this.root = newModule
    } else {
      const parent = this.get(path.slice(0, -1))
      parent.addChild(path[path.length - 1], newModule)
    }

    // register nested modules
    if (rawModule.modules) {
      forEachValue(rawModule.modules, (rawChildModule, key) => {
        this.register(path.concat(key), rawChildModule, runtime)
      })
    }
  }

  unregister (path) {
    const parent = this.get(path.slice(0, -1))
    const key = path[path.length - 1]
    if (!parent.getChild(key).runtime) return

    parent.removeChild(key)
  }
}
```
所以使用了module后，state就被模块化，比如要调用根模块的state，则`store.state.xxx`，如果要调用a模块的state，则调用`store.state.a.xxx`
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
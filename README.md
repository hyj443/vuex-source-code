# 可以一口气读完的Vuex源码解析

## 回顾一下Vuex是什么

Vuex 是一个专为Vue框架设计的，进行状态管理的库，将共享的数据抽离，放到全局形成一个单一的store，同时利用了Vue内部的响应式机制来进行状态的管理和更新。
![vuex组成](https://vuex.vuejs.org/vuex.png)
Vuex，在全局有一个state存放数据，所有修改state的操作必须通过mutation进行，mutation的同时，提供了订阅者模式供外部插件调用，获取state数据的更新。
所有异步操作都走action，比如调用后端接口异步获取数据，action同样不能直接修改state，要通过若干个mutation来修改state，所以Vuex中数据流是单向的。
state的变化是响应式的，因为Vuex依赖Vue的数据双向绑定，需要new一个Vue对象来实现响应式化。

看源码之前再看一遍[Vuex文档](https://vuex.vuejs.org/zh/)会加深理解，建议抽空过一遍。

## Vuex的安装

```js
import Vue from 'vue';
import Vuex from 'vuex';
Vue.use(vuex);
```

在使用Vuex前，要先安装Vuex，即执行 Vue.use(vuex)。

Vue.js 文档原话是：

>Vue.use(plugin)
>安装 Vue.js 插件。如果plugin是一个对象，它必须提供 install 方法。如果plugin是一个函数，则它被作为 install 方法。
>Vue.use 需要在调用 new Vue() 之前被调用。

我们不妨看看 `Vue` 源码中 `Vue.use` 的实现，看看是如何调用了插件的 `install`。


```js
initUse(Vue);
function initUse (Vue) {
  Vue.use = function (plugin) {
    var installedPlugins = (this._installedPlugins || (this._installedPlugins = []));
    if (installedPlugins.indexOf(plugin) > -1) { 
      return this // 注册过此插件，直接返回 Vue 本身
    }
    var args = toArray(arguments, 1); 
    // 从索引1开始，参数类数组转成数组
    args.unshift(this); // args数组的第一项是Vue
    if (typeof plugin.install === 'function') {
      plugin.install.apply(plugin, args); 
    // 调用install，把Vue作为第一个参数传入
    } else if (typeof plugin === 'function') {
      plugin.apply(null, args);
    }
    installedPlugins.push(plugin); // 注册过的plugin
    return this
  };
}
```
所以我们看到，Vue.use执行时，install调用时，会将 Vue 作为参数传入

我们看到 Vuex 的入口文件，在src\index.js。

```js
// 入口文件
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
导出的对象对外暴露了install方法，接下来我们看 `install` 方法到底做了什么。

```js
let Vue
// ....
function install (_Vue) {
  if (Vue && _Vue === Vue) { //避免重复安装 Vuex
      console.error(
        '[vuex] already installed. Vue.use(Vuex) should be called only once.'
      );
    return
  }
  Vue = _Vue; // 保存传入的Vue对象
  applyMixin(Vue);
}
```

所以install代码做了两件事：

1. 避免Vuex重复安装: 如果 Vue 有值，并且 === 传入的 Vue 对象，直接返回
2. 调用applyMixin(Vue)

所以，applyMixin 方法做了真正的安装工作，我们看看 applyMixin 的实现：

```js
function applyMixin (Vue) {
  const version = Number(Vue.version.split('.')[0])
  if (version >= 2) {
    Vue.mixin({ beforeCreate: vuexInit })
  } else {
    // Vue 1.x 的处理，不做分析
  }
  function vuexInit () {
    // 暂时省略
  }
}
```
applyMixin 中，先判断Vue的版本，1.x版本我们不做分析，2.x的版本，调用 Vue.mixin。它的作用是：全局注册一个混入，会影响注册之后创建的每个 Vue 实例。

由此可知，applyMixin 在全局注册混入一个 beforeCreate 生命周期函数：vuexInit，每个 Vue 实例的生命周期中都会调用它。

那vuexInit做了什么呢，顾名思义，就是 vuex 的初始化。看看它的实现：

```js
function vuexInit () {
  var options = this.$options;
  // store 注入
  if (options.store) {
    this.$store = typeof options.store === 'function'
      ? options.store()
      : options.store;
  } else if (options.parent && options.parent.$store) {
    this.$store = options.parent.$store;
  }
}
```
vuexInit执行时，this执行当前Vue实例，所以this.$options就是当前 Vue 实例的初始化选项，this.$options.store就是我们传入new Vue的options对象中的store对象。
```js
new Vue({
  store,
  router,
  render: h => h(App)
}).$mount('#app')
```
回到vuexInit，注意到if else判断，如果options.store存在，说明当前是根Vue实例，传入store对象，我们把它赋给this.$store，挂到实例上；如果不是根Vue实例，再判断，是否有父组件并且父组件是否有$store，如果有，当前子组件也挂一个$store属性，属性值为父组件的$store，即options.parent.$store

因此 vuexInit就是将 `new Vue()` 时传入的 `store` 对象保存到根实例的 `$store`，再赋给它下面的子组件实例的 `$store`，每个组件的beforeCreate钩子执行后，组件实例都挂载了`$store`，值都取到了同一个 `store` 对象。

这种子组件从父组件中拿的注入机制，使得之后创建的每一个Vue实例都能访问到根实例中注册的store对象。

## 怎么理解 store 对象

介绍完 Vuex 的安装，我们知道了 store 对象的注入机制，那么，store 对象是怎么来的，是通过 `new Vuex.Store()` 出来的，Store 构造函数接收一个对象，包含actions、getters、state、mutations、modules等。

```js
const store = new Vuex.Store({
  state,
  mutations,
  actions,
  getters,
  modules
})
```

## 探究 Store 类

我们来看看 Store 这个 class ，先看看 `constructor`，由于代码比较长，我们拆分成几段来看：

```js
export class Store {
  constructor(options = {}) {
    if (!Vue && typeof window !== 'undefined' && window.Vue) {
      install(window.Vue)
    }
    if (process.env.NODE_ENV !== 'production') {
      assert(Vue, `must call Vue.use(Vuex) before creating a store instance.`)
      assert(typeof Promise !== 'undefined', `vuex requires a Promise polyfill in this browser.`)
      assert(this instanceof Store, `store must be called with the new operator.`)
    }
    // 省略……
  }
  // 省略……
}
```

首先，判断是否调用过 Vue.use(Vuex) ，没有的话，且是在浏览器环境下，并且window上有 Vue ，就执行刚才我们看的 install 方法，自动安装。

然后是三个 assert函数：（附注：assert:state it firmly.断言）

1. 确保Vue对象存在。在实例化 store 之前必须调用 Vue.use(Vuex)；
2. 确保Promise能用，Vuex 依赖 promise ，后面会讲到；
3. this 必须是 Store 的实例（Store 的调用必须用 new 字符）

接着进行一系列初始化，初始化一些内部属性。

```js
  const { plugins = [], strict = false} = options // 解构赋值
  // store实例的内部状态
  this._committing = false // 提交mutation状态的标志
  this._actions = Object.create(null) // 存放actions
  this._actionSubscribers = [] // action 订阅函数集合
  this._mutations = Object.create(null) // 存放mutations
  this._wrappedGetters = Object.create(null) // 存放getters
  this._modules = new ModuleCollection(options) // module收集器，options就是new Vuex.Store()传入的
  this._modulesNamespaceMap = Object.create(null) // 模块命名空间
  this._subscribers = [] // 存储所有对mutation变化的订阅者
  this._watcherVM = new Vue() // Vue实例，用它的$watch来观测变化
```

plugins 是我们在实例化Store传入的配置项之一，是Vuex的插件，数组
strict 是否是严格模式，后面会提到严格模式的话会执行 enableStrictMode 方法，确保只能通过 mutation 修改 state

插一句，这里创建空对象用的是 Object.create(null)，原型为null，如果直接用字面量创建{}，等价于Object.create(Object.prototype)，它会从Object原型上继承一些方法，如hasOwnProperty、isPrototypeOf。

属性初始化的重点是初始化 module： `new ModuleCollection(options)`，稍后会详细介绍。接下来继续看完 Store 的 constructor ：

```js
  const store = this // store 取到当前 Store 实例
  const { dispatch, commit } = this // dispatch、commit 取到 Store 原型上的同名方法
  this.dispatch = function boundDispatch(type, payload) { // 分别挂载到 store 实例
    return dispatch.call(store, type, payload) // 并把执行时的 this 指向 store
  }
  this.commit = function boundCommit(type, payload, options) {
    return commit.call(store, type, payload, options)
  }
```

从 this（store实例）解构出 Store 的原型上的 dispatch 、commit 方法，通过  call 调用，将执行时的 this 指向当前 store 实例，dispatch、commit 方法挂载到 store 实例上。

接着看 constructor

```js
  this.strict = strict // options中传入的，是否启用严格模式
  
  const state = this._modules.root.state // this._modules = new ModuleCollection(config)

  installModule(this, state, [], this._modules.root)

  resetStoreVM(this, state)

  plugins.forEach(plugin => plugin(this)) // 注册 Vuex 插件

  const useDevtools = options.devtools !== undefined ? options.devtools : Vue.config.devtools
  if (useDevtools) {
    devtoolPlugin(this)
  }
```

这里已经是 Vuex 初始化的核心了，包括了：严格模式的设置、根state的赋值、模块的注册、state的响应式化、插件的注册。我们会逐个来看。

到现在，constructor 的代码已过了一遍。Store 函数主要做了三件事：

1. 初始化一些内部变量，重点是 初始化 module
2. 执行 installModule ，安装了模块
3. 执行了 resetStoreVM ，使 store 响应式化

我们逐个细说这三件事。

### Module 收集

我们知道 store 使用单一的状态树，所有状态会集中在一个较大的对象，如果应用变得很复杂，store 对象就可能很臃肿。为了解决这个问题，Vuex 允许我们将store 切割成 module，每个模块都有自己的 state 、mutation、action、getter、甚至子模块，像这样从上至下进行同样方式的分割：

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

从数据结构来看，module 的设计就是一个树形结构，store本身可以理解为一个root module，下面是一些子 module
构建这种树形结构的入口是：

`this._modules = new ModuleCollection(options)`

ModuleCollection 接收 new Vuex.Store(options) 的 options，`ModuleCollection` 做了什么？

```js
export default class ModuleCollection {
  constructor (rawRootModule) {
    this.register([], rawRootModule, false) // 注册根模块
  }
  get (path) {...}
  getNamespace (path) {...}
  update (rawRootModule) {...}
  register (path, rawModule, runtime = true) {
    // 省略，后面会展开讲
  }
  unregister (path) {...}
}
```

我们发现，ModuleCollection 的实例化，其实就是执行 register 。

这个方法接收 3 个参数，第一个 path 是module的路径，这个值是我们拆分module时，module的key组成的数组，比如前面的例子中，moduleA 的 path 是 ['a'] ， moduleB 的 path 是 ['b'] ，如果他们还有子模块，则子模块的 path 就大致形如 ['a','a1'] 、['a','a2'] 、['b','b1'] 。

第二个参数 rawModule，是定义当前 module 的配置，像 rawRootModule 就是实例化 Store 时传入的 options。

第三个参数 runtime 表示是否是一个运行时创建的module，默认为 true。

实例化 ModuleCollection 上来就执行 register 传入空数组、实例化Store时传入的options、false，其实就是注册根 module，来看 register 干了什么：

```js
// ModuleCollection 的原型方法 register
register (path, rawModule, runtime = true) {
  if (process.env.NODE_ENV !== 'production') {
    assertRawModule(path, rawModule)
  }

  const newModule = new Module(rawModule, runtime)

  if (path.length === 0) { // 如果path是空数组，说明是 根 模块
    this.root = newModule
  } else {
    const parent = this.get(path.slice(0, -1))
    parent.addChild(path[path.length - 1], newModule)
  }

  // register 嵌套的子模块
  if (rawModule.modules) {
    forEachValue(rawModule.modules, (rawChildModule, key) => {
      this.register(path.concat(key), rawChildModule, runtime)
    })
  }
}
```

在 register 中，先调用 assertRawModule 对 module 作一些判断，遍历 module 内部的 getters、mutations、actions 是否符合要求，这里不作具体分析。

然后通过 new Module 新建一个 module 对象 。如果 path 为 []，就说明是当前注册的是 root module，我们把 newModule 保存到 this.root，然后判断 rawModule.modules 是否存在，也就是，当前模块是否有嵌套的子模块。对当前是根模块的情况来说，就是看看 Store 实例化时的 options 里有没有传 modules，有就遍历 modules 里的每个键值对，逐个执行回调函数，目的是依次注册子模块。

然而子模块也可能有自己的嵌套模块，所以在回调函数中递归调用 register，将当前遍历的key值追加到path，和value值（遍历的子模块对象）、runtime一同作为参数传入 register。

我们看看 forEachValue 是如何遍历 modules 对象：

```js
export function forEachValue (obj, fn) {
  Object.keys(obj).forEach(key => fn(obj[key], key))
}
```

遍历 key 们，对每个 key-value 执行 fn，参数 value 在前。

所以第二次调用 register 时，因为当前模块是子模块了，就会进入 else 部分，通过 getChild 先获取到父模块，再调用 addChild，建立 module 之间的父子关系。然后再看当前子模块是否还有子模块，有则继续调用 register。

到这里，你还不了解 getChild、addChild 怎么实现的，它们其实是 Module 的原型方法，我们先看看 Module 构造函数。

```js
const newModule = new Module(rawModule, runtime)
```

Vuex 的设计者将用户定义的 module 配置称为 rawModule ，因为它单纯就是一个配置对象，根据这些配置调用 new Moudle 之后才实现了从 rawModule 到 newModule 的转变，raw 是“未加工的”之意

```js
export default class Module {
  constructor (rawModule, runtime) {
    this.runtime = runtime
    this._children = Object.create(null) // 保存该模块的子模块
    this._rawModule = rawModule // 存放模块配置
    const rawState = rawModule.state
    // 存放module的state
    this.state = (typeof rawState === 'function' ? rawState() : rawState) || {}
  }
  get namespaced () {
    return !!this._rawModule.namespaced
  }
  addChild (key, module) { // 子模块写入_children中
    this._children[key] = module
  }
  removeChild (key) {
    delete this._children[key]
  }
  getChild (key) { // 返回子模块
    return this._children[key]
  }
  update (rawModule) {
    this._rawModule.namespaced = rawModule.namespaced
    if (rawModule.actions) {
      this._rawModule.actions = rawModule.actions
    }
    if (rawModule.mutations) {
      this._rawModule.mutations = rawModule.mutations
    }
    if (rawModule.getters) {
      this._rawModule.getters = rawModule.getters
    }
  }
  forEachChild (fn) {
    forEachValue(this._children, fn)
  }
  forEachGetter (fn) {
    if (this._rawModule.getters) {
      forEachValue(this._rawModule.getters, fn)
    }
  }
  forEachAction (fn) {
    if (this._rawModule.actions) {
      forEachValue(this._rawModule.actions, fn)
    }
  }
  forEachMutation (fn) {
    if (this._rawModule.mutations) {
      forEachValue(this._rawModule.mutations, fn)
    }
  }
}
```

Module 构造函数先对传入的一些值进行保存，传入的 rawModule 和 runtime ，this._children 存放该模块的子模块，this.state 存放该模块的 state 。

此外，Module 提供了很多原型方法：
namespaced：当前模块的配置中是否存在 namespaced
addChild：将子模块（key - module）存到 this._children
removeChild：从 this._children 删除子模块（key - module）
getChild：从 this._children 根据 key 获取 子模块 module
update：负责整个模块的更新
....

现在我们回过头，梳理整个 new ModuleCollection 的过程，这是一个构建 module 和收集 module 的过程。

先执行register，注册 root module ，传入空数组 path、rawRootModule、runtime，在 register 内部，新建一个 module 对象，此时为根 module 对象，把它存到 this.root，然后看 rawRootModule 里有没有 modules ，有就遍历里面的键值对，应用回调函数（递归调用 register ），传入子模块的 path、value值（遍历的rawChildModule）、runtime。

我们构建 module 的同时，要建立父子模块之间的关系，因此，通过判断 path 的长度，为 0 代表是根 module ，赋给 this.root ；否则，获取到这个 module 的 parent。

`const parent = this.get(path.slice(0, -1))`

父模块的 path 就是当前 path 截取到倒数第二个元素，我们来看 get 的实现：

```js
// ModuleCollection 的原型方法 get
get (path) {
  return path.reduce((module, key) => {
    return module.getChild(key)
  }, this.root)
}
```

因为path是整个模块树的路径，这里通过reduce方法一层层解析去找到对应模块，查找的过程是用的module.getChild(key)方法，返回的是this._children[key]，这些_children就是通过执行parent.addChild(path[path.length - 1], newModule)方法添加的，就这样，每一个模块都通过path去寻找到parent`module，然后通过addChild建立父子关系，逐级递进，构建完成整个module`树。

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


所以使用了module后，state就被模块化，比如要调用根模块的state，则`store.state.xxx`，如果要调用a模块的state，则调用`store.state.a.xxx`
但你在跟模块注册的mutation和在子模块注册的mutation，如果同名的话，调用store.commit('xxx')，将会调用根模块和子模块的该mutation，除非区分命名
vuex2后的版本添加了命名空间的功能，使得module更加模块化，只有state是被模块化了，action mutation getter都还是在全局的模块下

使用了 module 之后，state 则会被模块化。比如要调用根模块的 state，则调用 store.state.count，如果要调用 a 模块的 state，则调用 store.state.a.count。
但是示例中的 mutation 则是注册在全局下的，即调用 store.commit('addNote')，将会调用跟模块和 a 模块的 mutation。除非区分各模块 mutation 的命名，否则，在同名的情况下，只要 commit 后就会被触发调用。
当然，vuex 2.0.0 后面的版本添加了命名空间 的功能，使得 module 更加的模块化。
所以接下来要解读的 module 中，实际上只要 state 是被模块化了， action、mutation 和 getter 还是在全局的模块下。



